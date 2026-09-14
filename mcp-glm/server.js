"use strict";

/*
 * 一个手写的 MCP 服务端：stdio 传输，把 glm-4.6-flash 包装成 MCP 工具。
 *
 * 为什么手写而不是用 SDK：这个文件里每一行都是协议本体，
 * 你可以直接看到「客户端发什么 → 服务端回什么」。
 *
 * 三条必须记住的规矩：
 *   1. stdout 只准出现协议消息。任何一句 console.log 都会污染协议流，
 *      客户端会直接报解析错误。所以本文件第一件事就是把 console.log 改道到 stderr。
 *   2. 一条消息占一行，用 \n 分隔。
 *   3. 工具执行失败 ≠ 协议错误。工具失败要回 isError:true 的正常结果，
 *      让模型看到失败原因；只有「方法不存在 / 参数不合法」这类才回 JSON-RPC error。
 */

// ---- 规矩 1：先把 console.log 掐掉，避免任何意外输出进 stdout ----
console.log = (...args) => console.error("[server]", ...args);

const fs = require("node:fs");
const path = require("node:path");
const {
  ERROR_CODES,
  LineDecoder,
  createWriter,
  isRequest,
  isNotification,
  notification,
  result,
  error,
  validate,
} = require("./protocol");

/* ==================== 配置 ==================== */

const CONFIG = {
  apiKey: process.env.GLM_API_KEY || process.env.ZHIPUAI_API_KEY || "",
  baseUrl: (process.env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, ""),
  model: process.env.GLM_MODEL || "glm-4.6-flash",
  // 看图必须用视觉模型。默认跟文本模型同名；如果你那边这个型号不接受图片，
  // 把它改成视觉型号即可，代码不用动。
  visionModel: process.env.GLM_VISION_MODEL || process.env.GLM_MODEL || "glm-4.6-flash",
  timeoutMs: Number(process.env.GLM_TIMEOUT_MS || 60000),
  // 安全边界：只允许读取这些目录下的图片，默认只有当前工作目录。
  // 没有这条边界，这个工具就是"把任意本地文件上传到远端"的后门。
  visionRoots: (process.env.GLM_VISION_ROOTS || process.cwd())
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item)),
  visionMaxBytes: Number(process.env.GLM_VISION_MAX_BYTES || 8 * 1024 * 1024),
  debug: process.env.MCP_DEBUG === "1",
};

/* 服务端支持的协议版本，新的在前。客户端要哪个就给哪个。 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const SERVER_INFO = {
  name: "glm-mcp",
  title: "GLM-4.6-Flash MCP 服务端",
  version: "1.0.0",
};

/* ==================== 与 GLM 的 HTTP 交互 ==================== */

/**
 * 调用 GLM 的 chat/completions 接口。
 * 刻意不用任何 SDK，直接 fetch，方便你看清请求体和响应体长什么样。
 */
async function callGLM({ messages, temperature, maxTokens, model, signal }) {
  if (!CONFIG.apiKey) {
    const err = new Error("没有配置 API Key。请设置环境变量 GLM_API_KEY（或 ZHIPUAI_API_KEY）后重试。");
    err.code = "NO_API_KEY";
    throw err;
  }

  const url = CONFIG.baseUrl + "/chat/completions";
  const body = { model: model || CONFIG.model, messages: messages, stream: false };
  if (typeof temperature === "number") body.temperature = temperature;
  if (typeof maxTokens === "number") body.max_tokens = maxTokens;

  // 超时：客户端取消 或 计时到点，两种都要能打断请求
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("请求超时")), CONFIG.timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + CONFIG.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    const aborted = cause && cause.name === "AbortError";
    const err = new Error(
      aborted
        ? "调用 GLM 超时（" + CONFIG.timeoutMs + "ms）：" + url
        : "无法连接 GLM 接口：" + url + "（" + (cause && cause.message) + "）"
    );
    err.code = aborted ? "TIMEOUT" : "NETWORK";
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();
  let payload;
  try {
    payload = rawText === "" ? {} : JSON.parse(rawText);
  } catch {
    payload = { raw: rawText };
  }

  if (!response.ok) {
    const hint =
      response.status === 401
        ? "API Key 无效或未生效，检查 GLM_API_KEY。"
        : response.status === 429
        ? "触发限流，降低调用频率后重试。"
        : response.status === 404
        ? "接口路径不对，检查 GLM_BASE_URL 是否包含正确的版本前缀（例如 /api/paas/v4）。"
        : "接口返回了错误，详见原始响应。";
    const err = new Error("GLM 接口返回 HTTP " + response.status + "：" + hint);
    err.code = "UPSTREAM_HTTP";
    err.data = payload;
    throw err;
  }

  const choice = payload.choices && payload.choices[0];
  const text =
    choice && choice.message && typeof choice.message.content === "string" ? choice.message.content : "";

  return {
    text: text,
    finishReason: choice ? choice.finish_reason : undefined,
    usage: payload.usage,
    model: payload.model || model || CONFIG.model,
  };
}

/* ==================== 图片读取（带安全边界） ==================== */

const MIME_BY_EXTENSION = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * 读一张本地图片并转成 data URL。
 *
 * 三道检查缺一不可：
 *   1. 路径必须落在允许的根目录内（否则这个工具就是本地文件外泄通道）
 *   2. 扩展名必须是受支持的图片格式
 *   3. 文件大小必须在上限内（base64 之后还会膨胀约 1/3）
 */
function loadImageAsDataUrl(filePath) {
  const resolved = path.resolve(filePath);
  const insideAllowedRoot = CONFIG.visionRoots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
  if (!insideAllowedRoot) {
    throw Object.assign(
      new Error(
        "拒绝读取：" + resolved + " 不在允许的目录内。\n允许的目录：" +
          CONFIG.visionRoots.join("、") +
          "\n如需放行，设置环境变量 GLM_VISION_ROOTS（多个目录用分号分隔）。"
      ),
      { code: "PATH_NOT_ALLOWED" }
    );
  }

  const extension = path.extname(resolved).toLowerCase();
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) {
    throw Object.assign(
      new Error(
        "不支持的图片格式：" + (extension || "（无扩展名）") +
          "。支持：" + Object.keys(MIME_BY_EXTENSION).join(" ")
      ),
      { code: "UNSUPPORTED_FORMAT" }
    );
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (cause) {
    throw Object.assign(new Error("读不到这个文件：" + resolved + "（" + cause.message + "）"), {
      code: "FILE_NOT_FOUND",
    });
  }
  if (!stat.isFile()) {
    throw Object.assign(new Error("这不是一个文件：" + resolved), { code: "NOT_A_FILE" });
  }
  if (stat.size > CONFIG.visionMaxBytes) {
    throw Object.assign(
      new Error(
        "图片太大：" + Math.round(stat.size / 1024) + " KB，上限 " +
          Math.round(CONFIG.visionMaxBytes / 1024) + " KB。请先压缩或裁剪。"
      ),
      { code: "FILE_TOO_LARGE" }
    );
  }

  return {
    dataUrl: "data:" + mime + ";base64," + fs.readFileSync(resolved).toString("base64"),
    bytes: stat.size,
    mime: mime,
    path: resolved,
  };
}

/* ==================== 工具定义 ==================== */

const TOOLS = [
  {
    name: "glm_chat",
    title: "调用 GLM-4.6-Flash 对话",
    description:
      "把一段提示词发给 GLM-4.6-Flash，返回纯文本回复。适合让模型做草拟、解释、改写、初步判断。" +
      "注意：模型输出不能当作经过验证的结论，工程数值必须自己复核。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, description: "用户提示词。" },
        system: { type: "string", description: "可选的系统提示词，用来设定角色与约束。" },
        history: {
          type: "array",
          maxItems: 50,
          description: '可选的多轮历史，元素形如 {"role":"user"|"assistant","content":"..."}。',
        },
        temperature: { type: "number", minimum: 0, maximum: 2, description: "采样温度。" },
        max_tokens: { type: "integer", minimum: 1, description: "回复的最大 token 数。" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "glm_json",
    title: "让 GLM 返回结构化 JSON",
    description:
      "要求 GLM-4.6-Flash 只输出一个 JSON 对象，服务端会把它解析出来。" +
      "解析成功时同时给出 structuredContent；解析失败时不编造，原样返回文本并标记 isError。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, description: "要模型提取或生成的内容。" },
        system: { type: "string", description: "可选的系统提示词。" },
        schema_hint: { type: "string", description: '期望的 JSON 结构说明，例如 {"name":"","qty":0}。' },
        temperature: { type: "number", minimum: 0, maximum: 2 },
      },
      required: ["prompt"],
    },
  },
  {
    name: "glm_config",
    title: "查看当前 GLM 配置",
    description:
      "不发起任何网络请求，只回报服务端解析到的接口地址、模型名、超时设置，以及是否已配置 API Key。排错时先调它。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "glm_vision",
    title: "让视觉模型看本地图片",
    description:
      "把本地图片（截图、照片、图纸）连同提示词一起发给视觉模型，返回它的文字描述或判断。" +
      "只能读取 GLM_VISION_ROOTS 允许目录内的图片。注意：返回的是模型的描述而不是像素本身，" +
      "细节判断仍需人工复核。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, description: "要模型看图做什么，越具体越好。" },
        images: {
          type: "array",
          maxItems: 4,
          description: "本地图片路径数组，1–4 张。必须位于允许的目录内。",
        },
        system: { type: "string", description: "可选的系统提示词。" },
      },
      required: ["prompt", "images"],
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/* ==================== 工具实现 ==================== */
/* 约定：返回 { text, structuredContent?, isError? }，由调用方组装成 MCP 结果。 */

async function runTool(name, args, signal) {
  if (name === "glm_config") {
    const lines = [
      "模型：" + CONFIG.model,
      "接口：" + CONFIG.baseUrl + "/chat/completions",
      "超时：" + CONFIG.timeoutMs + " ms",
      "API Key：" + (CONFIG.apiKey ? "已配置（长度 " + CONFIG.apiKey.length + "，不显示内容）" : "未配置"),
      "视觉模型：" + CONFIG.visionModel,
      "图片允许目录：" + CONFIG.visionRoots.join("、"),
      "单图上限：" + Math.round(CONFIG.visionMaxBytes / 1024) + " KB",
      "协议版本：" + LATEST_PROTOCOL_VERSION,
      "运行环境：Node " + process.version,
    ];
    return { text: lines.join("\n") };
  }

  const messages = [];
  if (args.system) messages.push({ role: "system", content: String(args.system) });
  for (const turn of args.history || []) {
    if (!turn || typeof turn.content !== "string") continue;
    messages.push({ role: turn.role === "assistant" ? "assistant" : "user", content: turn.content });
  }

  if (name === "glm_chat") {
    messages.push({ role: "user", content: String(args.prompt) });
    const reply = await callGLM({
      messages: messages,
      temperature: args.temperature,
      maxTokens: args.max_tokens,
      signal: signal,
    });
    const footer = reply.usage
      ? "\n\n---\n模型：" + reply.model + "　用量：" + (reply.usage.total_tokens ?? "?") +
        " tokens　结束原因：" + (reply.finishReason ?? "?")
      : "";
    return { text: reply.text + footer, structuredContent: reply };
  }

  if (name === "glm_json") {
    const instruction = [
      "只输出一个 JSON 对象，不要输出任何解释文字、前言、后记，也不要用 Markdown 代码块包裹。",
      args.schema_hint ? "期望的结构：" + args.schema_hint : "",
    ]
      .filter(Boolean)
      .join("\n");

    messages.push({ role: "user", content: instruction + "\n\n任务：" + args.prompt });
    const reply = await callGLM({ messages: messages, temperature: args.temperature, signal: signal });

    // 宽容一点：模型有时仍会包一层 ```json，先把代码块剥掉再解析。
    const cleaned = reply.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

    try {
      const parsed = JSON.parse(cleaned);
      return {
        text: JSON.stringify(parsed, null, 2),
        structuredContent: { data: parsed, usage: reply.usage, model: reply.model },
      };
    } catch {
      // 解析失败不要假装成功，也不要替模型修补内容。
      return {
        text: "模型没有返回可解析的 JSON。下面是原始输出，请据此调整提示词后重试：\n\n" + reply.text,
        isError: true,
      };
    }
  }

  if (name === "glm_vision") {
    const paths = Array.isArray(args.images) ? args.images : [];
    if (paths.length === 0) {
      throw Object.assign(new Error("images 至少要给一张图片路径"), { code: "NO_IMAGES" });
    }
    const loaded = paths.map((item) => loadImageAsDataUrl(String(item)));

    // 内容块数组：图片在前、文字在后。
    // 智谱 GLM-4V 系列的文档示例就是这个顺序；换服务商若要求文字在前，
    // 把下面两段的先后调换即可。
    const blocks = [];
    for (const image of loaded) {
      blocks.push({ type: "image_url", image_url: { url: image.dataUrl } });
    }
    blocks.push({ type: "text", text: String(args.prompt) });

    const visionMessages = [];
    if (args.system) visionMessages.push({ role: "system", content: String(args.system) });
    visionMessages.push({ role: "user", content: blocks });

    const reply = await callGLM({
      messages: visionMessages,
      model: CONFIG.visionModel,
      signal: signal,
    });

    const header =
      "读取了 " + loaded.length + " 张图（" +
      loaded
        .map((image) => path.basename(image.path) + " " + Math.round(image.bytes / 1024) + "KB")
        .join("、") +
      "），模型：" + reply.model;

    return {
      text: header + "\n\n" + reply.text,
      structuredContent: {
        model: reply.model,
        usage: reply.usage,
        images: loaded.map((image) => ({
          path: image.path,
          bytes: image.bytes,
          mime: image.mime,
        })),
        text: reply.text,
      },
    };
  }

  throw Object.assign(new Error("未知工具：" + name), { code: "UNKNOWN_TOOL" });
}

/* ==================== 服务端主体 ==================== */

function createServer({ input = process.stdin, output = process.stdout } = {}) {
  const writer = createWriter(output);
  const decoder = new LineDecoder();
  const inFlight = new Map(); // id -> AbortController，用于响应 notifications/cancelled
  let initialized = false;
  let negotiatedVersion = null;

  function log(message) {
    if (!CONFIG.debug) return;
    console.error("[" + new Date().toISOString() + "] " + message);
  }

  function sendResult(id, value) {
    writer.send(result(id, value));
  }

  function sendError(id, code, message, data) {
    writer.send(error(id, code, message, data));
  }

  /** 服务端主动推给客户端的日志通知——这才是"底层"里最容易被忽略的一半。 */
  function sendLog(level, data) {
    writer.send(notification("notifications/message", { level: level, logger: "glm-mcp", data: data }));
  }

  function handleInitialize(id, params) {
    const requested = params && typeof params.protocolVersion === "string" ? params.protocolVersion : null;
    negotiatedVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION;
    if (requested && requested !== negotiatedVersion) {
      log("客户端要求协议版本 " + requested + "，本服务端不支持，改用 " + negotiatedVersion);
    }
    sendResult(id, {
      protocolVersion: negotiatedVersion,
      capabilities: { tools: { listChanged: false }, logging: {} },
      serverInfo: SERVER_INFO,
      instructions:
        "本服务端把 GLM-4.6-Flash 暴露成工具。调用 glm_chat 之前先用 glm_config 确认配置；" +
        "模型输出必须自行复核，不要直接当作工程结论。",
    });
  }

  async function handleToolsCall(id, params) {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const tool = TOOL_BY_NAME.get(name);

    if (!tool) {
      // 这是协议层错误：客户端调了一个不存在的工具。
      sendError(id, ERROR_CODES.INVALID_PARAMS, "未知工具：" + name, {
        available: [...TOOL_BY_NAME.keys()],
      });
      return;
    }

    const problems = validate(tool.inputSchema, args);
    if (problems.length > 0) {
      sendError(id, ERROR_CODES.INVALID_PARAMS, "参数不合法", { problems: problems });
      return;
    }

    const controller = new AbortController();
    inFlight.set(id, controller);
    sendLog("debug", "开始执行工具 " + name);

    try {
      const outcome = await runTool(name, args, controller.signal);
      const payload = { content: [{ type: "text", text: outcome.text }] };
      if (outcome.structuredContent !== undefined) payload.structuredContent = outcome.structuredContent;
      if (outcome.isError) payload.isError = true;
      sendResult(id, payload);
      sendLog("info", "工具 " + name + " 执行完成" + (outcome.isError ? "（业务失败）" : ""));
    } catch (cause) {
      // 工具执行失败：回正常结果 + isError，让模型看到原因并自行调整。
      // 千万不要把它变成 JSON-RPC error——那样模型根本看不到失败内容。
      const message = cause && cause.message ? cause.message : String(cause);
      const detail = cause && cause.data ? "\n\n原始响应：" + JSON.stringify(cause.data) : "";
      sendResult(id, {
        content: [
          {
            type: "text",
            text: "调用失败（" + (cause && cause.code ? cause.code : "ERROR") + "）：" + message + detail,
          },
        ],
        isError: true,
      });
      sendLog("error", "工具 " + name + " 失败：" + message);
    } finally {
      inFlight.delete(id);
    }
  }

  async function dispatch(message) {
    if (!message || message.jsonrpc !== "2.0") {
      sendError(message ? message.id : null, ERROR_CODES.INVALID_REQUEST, "不是合法的 JSON-RPC 2.0 消息");
      return;
    }

    // 通知：没有 id，不许回复。
    if (isNotification(message)) {
      switch (message.method) {
        case "notifications/initialized":
          initialized = true;
          log("客户端已完成初始化");
          break;
        case "notifications/cancelled": {
          const targetId = message.params && message.params.requestId;
          const controller = inFlight.get(targetId);
          if (controller) {
            controller.abort(new Error("客户端取消了请求"));
            log("按客户端要求取消请求 " + targetId);
          }
          break;
        }
        default:
          log("忽略未知通知：" + message.method);
      }
      return;
    }

    if (!isRequest(message)) {
      sendError(message.id, ERROR_CODES.INVALID_REQUEST, "缺少 method 或 id 的消息无法处理");
      return;
    }

    const id = message.id;
    const method = message.method;
    const params = message.params;
    log("收到请求 " + method);

    try {
      switch (method) {
        case "initialize":
          handleInitialize(id, params);
          return;
        case "ping":
          sendResult(id, {});
          return;
        case "tools/list":
          sendResult(id, { tools: TOOLS });
          return;
        case "tools/call":
          await handleToolsCall(id, params);
          return;
        case "logging/setLevel":
          log("客户端把日志级别设为 " + (params && params.level));
          sendResult(id, {});
          return;
        case "resources/list":
          sendResult(id, { resources: [] });
          return;
        case "prompts/list":
          sendResult(id, { prompts: [] });
          return;
        default:
          sendError(id, ERROR_CODES.METHOD_NOT_FOUND, "本服务端不实现 " + method);
      }
    } catch (cause) {
      sendError(id, ERROR_CODES.INTERNAL_ERROR, cause && cause.message ? cause.message : String(cause));
    }
  }

  function feed(chunk) {
    const decoded = decoder.push(chunk);
    if (decoded.overflow) {
      sendError(null, ERROR_CODES.PARSE_ERROR, "单条消息超过 8MB 上限，且没有换行分隔");
      return;
    }
    for (const line of decoded.lines) {
      let message;
      try {
        message = JSON.parse(line);
      } catch (cause) {
        // 解析失败：id 必须回 null，因为我们无法知道它属于哪个请求。
        sendError(null, ERROR_CODES.PARSE_ERROR, "无法解析这一行 JSON：" + cause.message);
        continue;
      }
      // 故意不 await：一条慢请求不应该堵住后面的请求。
      dispatch(message).catch((cause) => {
        sendError(message && message.id, ERROR_CODES.INTERNAL_ERROR, String(cause));
      });
    }
  }

  input.setEncoding("utf8");
  input.on("data", feed);
  input.on("end", () => {
    for (const line of decoder.flush()) feed(line + "\n");
    log("输入流结束，服务端退出");
  });

  function stop() {
    for (const controller of inFlight.values()) controller.abort(new Error("服务端关闭"));
    inFlight.clear();
  }

  return {
    feed: feed,
    stop: stop,
    get initialized() {
      return initialized;
    },
  };
}

/* 直接运行本文件时启动 stdio 服务端。被 require 时不自动启动，方便测试。 */
if (require.main === module) {
  const server = createServer();
  process.on("SIGINT", () => {
    server.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    server.stop();
    process.exit(0);
  });
  // 兜底：未捕获异常绝不能把半截 JSON 写到 stdout
  process.on("uncaughtException", (cause) => {
    console.error("[server] 未捕获异常：", cause);
    process.exit(1);
  });
  console.error(
    "[server] glm-mcp 已启动｜模型 " + CONFIG.model + "｜接口 " + CONFIG.baseUrl +
      "｜API Key " + (CONFIG.apiKey ? "已配置" : "未配置（调用工具时会失败）")
  );
}

module.exports = { createServer, callGLM, TOOLS, CONFIG };
