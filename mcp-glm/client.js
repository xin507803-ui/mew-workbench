"use strict";

/*
 * 一个手写的 MCP 客户端。
 *
 * 它存在的意义：让你能亲眼看见一次完整的 MCP 会话长什么样。
 * 把 MCP_DEBUG=1 打开，它会把这四条消息原样打印出来：
 *   → initialize
 *   ← initialize 的结果
 *   → notifications/initialized
 *   → tools/list / tools/call
 *   ← 结果
 *
 * 用法（在 mcp-glm 目录下）：
 *   node client.js tools
 *   node client.js config
 *   node client.js call glm_chat "{\"prompt\":\"用一句话解释什么是公差堆叠\"}"
 *   MCP_DEBUG=1 node client.js ping        # Windows 上用 $env:MCP_DEBUG=1
 */

const { spawn } = require("node:child_process");
const path = require("node:path");
const {
  LineDecoder,
  isNotification,
  isResponse,
  request,
  notification,
} = require("./protocol");

class MCPClient {
  /**
   * @param {object} options
   * @param {string} options.command 可执行文件（默认用当前 node）
   * @param {string[]} options.args   参数
   * @param {object} [options.env]    额外环境变量
   * @param {boolean} [options.debug] 打印线级日志
   */
  constructor(options) {
    this.debug = Boolean(options.debug);
    this.nextId = 1;
    this.pending = new Map();
    this.decoder = new LineDecoder();
    this.notifications = [];
    this.closed = false;

    this.child = spawn(options.command || process.execPath, options.args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: Object.assign({}, process.env, options.env || {}),
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#onStdout(chunk));

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      // 服务端日志走 stderr，属于正常现象，直接透传给人看。
      if (this.debug) process.stderr.write("[server stderr] " + chunk);
    });

    this.child.on("exit", (code, signal) => {
      this.closed = true;
      for (const [, entry] of this.pending) {
        entry.reject(new Error(`服务端已退出（code=${code} signal=${signal}）`));
      }
      this.pending.clear();
    });
  }

  #onStdout(chunk) {
    const decoded = this.decoder.push(chunk);
    for (const line of decoded.lines) {
      let message;
      try {
        message = JSON.parse(line);
      } catch (cause) {
        // 客户端这一侧同样可能收到脏数据，必须自己扛住。
        this.#trace("← (解析失败)", line.slice(0, 200));
        continue;
      }
      this.#trace("←", JSON.stringify(message));

      if (isResponse(message)) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) {
          const err = new Error(message.error.message);
          err.code = message.error.code;
          err.data = message.error.data;
          entry.reject(err);
        } else {
          entry.resolve(message.result);
        }
        continue;
      }

      if (isNotification(message)) {
        this.notifications.push(message);
        if (message.method === "notifications/message") {
          const data = message.params && message.params.data;
          this.#trace("← 服务端日志", String(data));
        }
      }
    }
  }

  #trace(direction, text) {
    if (!this.debug) return;
    process.stderr.write(direction + " " + text + "\n");
  }

  #send(message) {
    if (this.closed) throw new Error("连接已关闭");
    this.#trace("→", JSON.stringify(message));
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  /** 发一个请求并等它的结果。带超时，避免永远挂住。 */
  request(method, params, { timeoutMs = 120000 } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`请求 ${method}（id=${id}）超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.#send(request(id, method, params));
    });
  }

  /** 发一个通知，不等回复（规范规定通知不许有回复）。 */
  notify(method, params) {
    this.#send(notification(method, params));
  }

  /** 完整握手：initialize → 等结果 → notifications/initialized。 */
  async initialize(clientInfo = { name: "mcp-glm-cli", version: "1.0.0" }) {
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: { roots: { listChanged: false } },
      clientInfo,
    });
    // 这一步是规范要求的：客户端确认自己准备好了，服务端此后才能推通知。
    this.notify("notifications/initialized");
    this.serverInfo = result.serverInfo;
    this.negotiatedVersion = result.protocolVersion;
    return result;
  }

  async listTools() {
    const result = await this.request("tools/list", {});
    return result.tools || [];
  }

  async callTool(name, args) {
    return this.request("tools/call", { name, arguments: args || {} });
  }

  /** 优雅关闭：先关 stdin，让服务端的输入流自然结束。 */
  async close() {
    if (this.closed) return;
    this.child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, 3000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.closed = true;
  }
}

/** 把 MCP 的 tools/call 结果转成便于阅读的文本。 */
function renderToolResult(result) {
  const parts = [];
  if (result && Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === "text") parts.push(block.text);
      else parts.push("[" + block.type + "] " + JSON.stringify(block));
    }
  }
  if (result && result.structuredContent !== undefined) {
    parts.push("\n--- structuredContent ---\n" + JSON.stringify(result.structuredContent, null, 2));
  }
  if (result && result.isError) parts.push("\n[这次调用被标记为 isError=true]");
  return parts.join("\n");
}

module.exports = { MCPClient, renderToolResult };

/* ==================== 命令行入口 ==================== */

if (require.main === module) {
  const [command = "tools", ...rest] = process.argv.slice(2);
  const debug = process.env.MCP_DEBUG === "1";
  const serverPath = path.join(__dirname, "server.js");

  const client = new MCPClient({
    command: process.execPath,
    args: [serverPath],
    debug,
  });

  (async () => {
    const handshake = await client.initialize();
    console.error(
      "[client] 已连接 " + handshake.serverInfo.name + " v" + handshake.serverInfo.version +
        "，协议版本 " + handshake.protocolVersion
    );

    if (command === "tools") {
      const tools = await client.listTools();
      for (const tool of tools) {
        console.log("● " + tool.name + " — " + (tool.title || ""));
        console.log("  " + tool.description);
        const required = (tool.inputSchema && tool.inputSchema.required) || [];
        const keys = Object.keys((tool.inputSchema && tool.inputSchema.properties) || {});
        console.log(
          "  参数：" + (keys.length === 0 ? "（无）" : keys.map((k) => (required.includes(k) ? k + "*" : k)).join(", "))
        );
        console.log("");
      }
    } else if (command === "call") {
      const [name, rawArgs] = rest;
      if (!name) throw new Error("用法：node client.js call <工具名> '<JSON 参数>'");
      let args = {};
      if (rawArgs) {
        try {
          args = JSON.parse(rawArgs);
        } catch (cause) {
          throw new Error("参数不是合法 JSON：" + cause.message);
        }
      }
      const result = await client.callTool(name, args);
      console.log(renderToolResult(result));
    } else if (command === "config") {
      console.log(renderToolResult(await client.callTool("glm_config", {})));
    } else if (command === "ping") {
      console.log("ping →", JSON.stringify(await client.request("ping", {})));
    } else if (command === "probe-errors") {
      // 故意打几个坏请求，用来看清错误码是怎么回来的。
      const cases = [
        ["不存在的方法", () => client.request("tools/nonexistent", {})],
        ["不存在的工具", () => client.callTool("nope", {})],
        ["缺必填参数", () => client.callTool("glm_chat", {})],
      ];
      for (const [label, run] of cases) {
        try {
          await run();
          console.log("× " + label + "：居然成功了（不应该）");
        } catch (cause) {
          console.log("√ " + label + " → 错误码 " + cause.code + "：" + cause.message +
            (cause.data ? " " + JSON.stringify(cause.data) : ""));
        }
      }
    } else {
      console.error("未知命令：" + command);
      console.error("可用：tools / call / config / ping / probe-errors");
      process.exitCode = 2;
    }
  })()
    .catch((cause) => {
      console.error("[client] 出错：" + cause.message);
      if (cause.data) console.error("       附带数据：" + JSON.stringify(cause.data));
      process.exitCode = 1;
    })
    .finally(() => client.close());
}
