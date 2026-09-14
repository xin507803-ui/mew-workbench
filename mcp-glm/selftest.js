"use strict";

/*
 * 离线自检：不需要真实 API Key，也不需要联网。
 *
 * 做法是自己起一个假的 GLM 接口（本地 HTTP 服务），把服务端的 GLM_BASE_URL
 * 指向它，然后驱动完整的 MCP 会话。这样协议层、参数校验、错误分支、
 * 甚至 401 处理都能在没有网络的情况下验证。
 *
 * 运行：node selftest.js
 */

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { MCPClient } = require("./client");

const results = [];
function check(label, passed, detail) {
  results.push({ label, passed });
  console.log((passed ? "PASS  " : "FAIL  ") + label + (detail ? "  → " + detail : ""));
}

/* ---------- 假的 GLM 接口 ---------- */

function startMockGLM() {
  const state = { mode: "ok", requests: [] };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // 测试里不关心坏请求体
      }
      state.requests.push({
        url: req.url,
        method: req.method,
        authorization: req.headers.authorization,
        contentType: req.headers["content-type"],
        body,
      });
      if (state.mode === "401") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "invalid_api_key", message: "鉴权失败" } }));
        return;
      }
      const last = (body.messages || []).slice(-1)[0];
      const prompt = last && typeof last.content === "string" ? last.content : "";
      let content = "这是一段模拟回复：GLM-4.6-Flash 收到了你的提示词。";
      if (prompt.includes("要JSON")) content = '{"name":"支架","qty":2}';
      if (prompt.includes("返回坏JSON")) content = "抱歉，我无法按要求输出 JSON。";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "mock-1",
          model: body.model,
          choices: [{ index: 0, message: { role: "assistant", content: content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42 },
        })
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        state: state,
        baseUrl: "http://127.0.0.1:" + port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/* ---------- 直接操纵向导流：验证解析错误 ---------- */

function probeParseError(serverPath, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: Object.assign({}, process.env, env),
    });
    let out = "";
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(value);
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const line = out.split("\n").find((l) => l.trim() !== "");
      if (line) {
        try {
          finish(JSON.parse(line));
        } catch {
          finish(null);
        }
      }
    });
    child.stdin.write("这一行不是 JSON\n");
    setTimeout(() => finish(null), 5000);
  });
}

/* ---------- 主流程 ---------- */

async function main() {
  const serverPath = path.join(__dirname, "server.js");
  const mock = await startMockGLM();
  const env = {
    GLM_API_KEY: "test-key-123456",
    GLM_BASE_URL: mock.baseUrl,
    GLM_MODEL: "glm-4.6-flash",
    GLM_TIMEOUT_MS: "15000",
    MCP_DEBUG: "1",
  };

  console.log("=== 1. 握手与工具清单 ===");
  const client = new MCPClient({ command: process.execPath, args: [serverPath], env: env, debug: false });
  const handshake = await client.initialize();
  check("initialize 返回 serverInfo",
    Boolean(handshake.serverInfo) && handshake.serverInfo.name === "glm-mcp",
    handshake.serverInfo && handshake.serverInfo.name);
  check("协议版本已协商",
    ["2025-06-18", "2025-03-26", "2024-11-05"].includes(handshake.protocolVersion),
    handshake.protocolVersion);
  check("声明了 tools 能力", Boolean(handshake.capabilities && handshake.capabilities.tools));

  const tools = await client.listTools();
  check("tools/list 返回 4 个工具", tools.length === 4, tools.map((t) => t.name).join(", "));
  check("每个工具都带 inputSchema",
    tools.every((t) => t.inputSchema && t.inputSchema.type === "object"));

  console.log("\n=== 2. 不联网的工具 ===");
  const configResult = await client.callTool("glm_config", {});
  const configText = configResult.content[0].text;
  check("glm_config 报出模型名", configText.includes("glm-4.6-flash"));
  check("glm_config 不回显 Key",
    configText.includes("已配置") && !configText.includes("test-key-123456"));

  console.log("\n=== 3. 真的走一遍 GLM 调用链（打到本地假接口） ===");
  const chat = await client.callTool("glm_chat", {
    prompt: "用一句话解释什么是公差堆叠",
    system: "你是一名机械工程师。",
  });
  check("glm_chat 返回文本", chat.content[0].text.includes("模拟回复"));
  check("返回里带用量信息", chat.content[0].text.includes("42"));
  const sent = mock.state.requests.slice(-1)[0];
  check("请求打到了 /chat/completions", sent.url === "/chat/completions", sent.url);
  check("带了 Bearer 鉴权头", sent.authorization === "Bearer test-key-123456");
  check("请求体带 model 字段", sent.body.model === "glm-4.6-flash", sent.body.model);
  check("system 提示词已合并进消息", sent.body.messages[0].role === "system");
  check("stream 明确为 false", sent.body.stream === false);

  console.log("\n=== 4. 结构化输出 ===");
  const goodJson = await client.callTool("glm_json", {
    prompt: "要JSON：列出零件名和数量",
    schema_hint: '{"name":"","qty":0}',
  });
  check("合法 JSON 被解析出来",
    !goodJson.isError && Boolean(goodJson.structuredContent) && goodJson.structuredContent.data.name === "支架");
  const badJson = await client.callTool("glm_json", { prompt: "返回坏JSON" });
  check("坏 JSON 不假装成功（isError=true）", badJson.isError === true);
  check("坏 JSON 原样返回了模型输出", badJson.content[0].text.includes("我无法按要求输出"));

  console.log("\n=== 5. 协议错误 vs 业务失败 ===");
  try {
    await client.callTool("nope", {});
    check("未知工具应报错", false);
  } catch (cause) {
    check("未知工具 → -32602", cause.code === -32602, "code=" + cause.code);
    check("错误里附了可用工具清单", Boolean(cause.data && cause.data.available));
  }
  try {
    await client.callTool("glm_chat", {});
    check("缺必填参数应报错", false);
  } catch (cause) {
    check("缺必填参数 → -32602", cause.code === -32602, JSON.stringify(cause.data));
  }
  try {
    await client.request("tools/nonexistent", {});
    check("未知方法应报错", false);
  } catch (cause) {
    check("未知方法 → -32601", cause.code === -32601, "code=" + cause.code);
  }

  console.log("\n=== 6. 上游返回错误时，工具失败而不是协议失败 ===");
  mock.state.mode = "401";
  const bad = await client.callTool("glm_chat", { prompt: "随便问一句" });
  check("401 被包成 isError 结果（模型能看到原因）", bad.isError === true);
  check("错误里点明了 API Key 问题", bad.content[0].text.includes("API Key"));
  mock.state.mode = "ok";

  console.log("\n=== 7. 服务端主动通知 ===");
  check("收到服务端 notifications/message",
    client.notifications.some((n) => n.method === "notifications/message"),
    "共 " + client.notifications.length + " 条");
  check("通知里带 level 字段",
    client.notifications.every((n) => !n.params || typeof n.params.level === "string"));

  console.log("\n=== 8. 脏输入 ===");
  const parseError = await probeParseError(serverPath, env);
  check("非法 JSON → -32700 且 id 为 null",
    Boolean(parseError) && Boolean(parseError.error) && parseError.error.code === -32700 && parseError.id === null,
    parseError ? "code=" + parseError.error.code : "无响应");

  console.log("\n=== 9. 看图（glm_vision） ===");
  // 造一张 1×1 的真 PNG，放在一个只给本次测试用的目录里。
  const visionDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-vision-"));
  const pngPath = path.join(visionDir, "tiny.png");
  fs.writeFileSync(
    pngPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    )
  );
  const outsidePath = path.join(os.tmpdir(), "glm-vision-outside.png");

  const visionClient = new MCPClient({
    command: process.execPath,
    args: [serverPath],
    env: Object.assign({}, env, { GLM_VISION_ROOTS: visionDir }),
    debug: false,
  });
  await visionClient.initialize();

  const vision = await visionClient.callTool("glm_vision", {
    prompt: "这张图里有什么？",
    images: [pngPath],
  });
  check("glm_vision 正常返回", !vision.isError && vision.content[0].text.includes("模拟回复"),
    vision.isError ? vision.content[0].text.split("\n")[0] : "ok");
  check("返回里注明读了哪张图", vision.content[0].text.includes("tiny.png"));
  check("structuredContent 带图片元信息",
    Boolean(vision.structuredContent) && vision.structuredContent.images[0].mime === "image/png");

  const visionRequest = mock.state.requests.slice(-1)[0];
  const visionContent = visionRequest.body.messages.slice(-1)[0].content;
  check("content 是内容块数组（不是字符串）", Array.isArray(visionContent));
  check("第一块是 image_url", visionContent[0].type === "image_url", visionContent[0].type);
  check("图片以 data URL 内联", visionContent[0].image_url.url.startsWith("data:image/png;base64,"),
    visionContent[0].image_url.url.slice(0, 32) + "...");
  check("data URL 能还原成合法 PNG",
    Buffer.from(visionContent[0].image_url.url.split(",")[1], "base64").subarray(1, 4).toString() === "PNG");
  check("文字块排在图片之后",
    visionContent[1].type === "text" && visionContent[1].text === "这张图里有什么？");
  check("看图用的是视觉模型字段", visionRequest.body.model === "glm-4.6-flash", visionRequest.body.model);

  const outside = await visionClient.callTool("glm_vision", { prompt: "看图", images: [outsidePath] });
  check("允许目录之外的路径被拒绝", outside.isError === true && outside.content[0].text.includes("拒绝读取"),
    outside.isError ? "已拒绝" : "居然读了");

  const missing = await visionClient.callTool("glm_vision", {
    prompt: "看图",
    images: [path.join(visionDir, "不存在.png")],
  });
  check("文件不存在时给出明确原因",
    missing.isError === true && missing.content[0].text.includes("读不到"), "ok");

  const wrongType = await visionClient.callTool("glm_vision", {
    prompt: "看图",
    images: [path.join(visionDir, "x.txt")],
  });
  check("非图片扩展名被拒绝",
    wrongType.isError === true && wrongType.content[0].text.includes("不支持的图片格式"), "ok");

  const strictClient = new MCPClient({
    command: process.execPath,
    args: [serverPath],
    env: Object.assign({}, env, { GLM_VISION_ROOTS: visionDir, GLM_VISION_MAX_BYTES: "10" }),
    debug: false,
  });
  await strictClient.initialize();
  const tooBig = await strictClient.callTool("glm_vision", { prompt: "看图", images: [pngPath] });
  check("超过体积上限被拒绝",
    tooBig.isError === true && tooBig.content[0].text.includes("图片太大"), "ok");
  await strictClient.close();

  await visionClient.close();
  fs.rmSync(visionDir, { recursive: true, force: true });

  await client.close();
  check("客户端能优雅关闭", client.closed === true);
  await mock.close();

  const failed = results.filter((r) => !r.passed);
  console.log("\n" + (failed.length === 0
    ? "全部通过：" + results.length + " 项"
    : "失败 " + failed.length + " / " + results.length + " 项：" + failed.map((f) => f.label).join("；")));
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((cause) => {
  console.error("\n自检本身崩了：", cause);
  process.exitCode = 1;
});
