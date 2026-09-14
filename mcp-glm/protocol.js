"use strict";

/*
 * MCP 的底层：JSON-RPC 2.0 + 换行分隔的 stdio 帧。
 *
 * 这个文件只管三件事，别的一个都不管：
 *   1. 把字节流切成一条条消息（LineDecoder）
 *   2. 把消息写出去，并且正确处理背压（createWriter）
 *   3. 拼出符合规范的 request / notification / response / error
 *
 * 记住一条铁律：stdio 传输只用换行分隔，一条消息必须在一行内。
 * 所以 JSON.stringify 出来的字符串里绝不能有裸的 \n——
 * 换行只能是分隔符，不能是内容。JSON.stringify 会自动把内容里的
 * 换行转义成 \\n，因此内容是安全的，但你自己拼字符串时就不安全了。
 */

/* JSON-RPC 2.0 规定的标准错误码，MCP 全部沿用。 */
const ERROR_CODES = {
  PARSE_ERROR: -32700,      // 收到的根本不是合法 JSON
  INVALID_REQUEST: -32600,  // 是合法 JSON，但不是合法的 JSON-RPC 消息
  METHOD_NOT_FOUND: -32601, // 方法不存在
  INVALID_PARAMS: -32602,   // 方法存在，但参数不对
  INTERNAL_ERROR: -32603,   // 服务端内部错误
};

/* 单条消息的上限。超过它基本可以确定是对方忘了发换行分隔符。 */
const MAX_LINE_BYTES = 8 * 1024 * 1024;

/* ---------- 1. 切帧 ---------- */

/**
 * 把任意大小的 chunk 喂进来，吐出完整的行。
 * 一次 chunk 可能包含半条消息、三条消息，或者半条+一条+半条。
 */
class LineDecoder {
  constructor(options = {}) {
    this.buffer = "";
    this.maxLineBytes = options.maxLineBytes || MAX_LINE_BYTES;
  }

  /**
   * @param {string|Buffer} chunk
   * @returns {{lines: string[], overflow: boolean}} 完整行；overflow 为真表示缓冲爆了
   */
  push(chunk) {
    this.buffer += chunk.toString("utf8");
    const lines = [];
    let index;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      // 兼容 \r\n：Windows 上的管道偶尔会带上 \r
      let line = this.buffer.slice(0, index);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.buffer = this.buffer.slice(index + 1);
      if (line.trim() !== "") lines.push(line);
    }
    const overflow = this.buffer.length > this.maxLineBytes;
    if (overflow) this.buffer = "";
    return { lines, overflow };
  }

  /** 进程退出前把残留内容当最后一条处理（正常情况应为空）。 */
  flush() {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest === "" ? [] : [rest];
  }
}

/* ---------- 2. 写出去 ---------- */

/**
 * 带背压处理的行写入器。
 *
 * stream.write() 返回 false 表示内核缓冲已满，这时必须停下来等 drain 事件，
 * 否则大量输出会把内存吃掉。MCP 的消息量通常很小，但写对了不吃亏。
 */
function createWriter(stream) {
  const queue = [];
  let blocked = false;

  function flush() {
    while (!blocked && queue.length > 0) {
      blocked = stream.write(queue.shift()) === false;
    }
  }

  stream.on("drain", () => {
    blocked = false;
    flush();
  });

  return {
    send(message) {
      queue.push(JSON.stringify(message) + "\n");
      flush();
    },
  };
}

/* ---------- 3. 消息构造 ---------- */

function isRequest(message) {
  return message && message.jsonrpc === "2.0" && typeof message.method === "string" && message.id !== undefined;
}

function isNotification(message) {
  return message && message.jsonrpc === "2.0" && typeof message.method === "string" && message.id === undefined;
}

function isResponse(message) {
  return message && message.jsonrpc === "2.0" && message.id !== undefined && typeof message.method !== "string";
}

function result(id, value) {
  return { jsonrpc: "2.0", id, result: value };
}

function error(id, code, message, data) {
  const payload = { code, message };
  if (data !== undefined) payload.data = data;
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: payload };
}

function notification(method, params) {
  const message = { jsonrpc: "2.0", method };
  if (params !== undefined) message.params = params;
  return message;
}

function request(id, method, params) {
  const message = { jsonrpc: "2.0", id, method };
  if (params !== undefined) message.params = params;
  return message;
}

/* ---------- 4. 给工具用的输入校验 ---------- */

/**
 * 极简的 JSON Schema 校验器，只支持本项目实际用到的关键字。
 * 真实项目请用完整的校验库；这里手写是为了让你看清
 * "参数不合法 → -32602" 这条链路是怎么发生的。
 */
function validate(schema, value, path = "arguments") {
  const problems = [];
  if (!schema || typeof schema !== "object") return problems;

  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`${path} 必须是对象`);
      return problems;
    }
    for (const key of schema.required || []) {
      if (value[key] === undefined) problems.push(`${path}.${key} 是必填项`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (value[key] === undefined) continue;
      problems.push(...validate(sub, value[key], `${path}.${key}`));
    }
    return problems;
  }

  if (value === undefined || value === null) return problems;

  if (schema.type === "string" && typeof value !== "string") problems.push(`${path} 必须是字符串`);
  if (schema.type === "number" && typeof value !== "number") problems.push(`${path} 必须是数字`);
  if (schema.type === "integer" && !Number.isInteger(value)) problems.push(`${path} 必须是整数`);
  if (schema.type === "boolean" && typeof value !== "boolean") problems.push(`${path} 必须是布尔值`);
  if (schema.type === "array" && !Array.isArray(value)) problems.push(`${path} 必须是数组`);

  if (typeof value === "string" && typeof schema.minLength === "number" && value.length < schema.minLength) {
    problems.push(`${path} 至少 ${schema.minLength} 个字符`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) problems.push(`${path} 不能小于 ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) problems.push(`${path} 不能大于 ${schema.maximum}`);
  }
  if (Array.isArray(value) && typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    problems.push(`${path} 最多 ${schema.maxItems} 项`);
  }
  return problems;
}

module.exports = {
  ERROR_CODES,
  MAX_LINE_BYTES,
  LineDecoder,
  createWriter,
  isRequest,
  isNotification,
  isResponse,
  request,
  notification,
  result,
  error,
  validate,
};
