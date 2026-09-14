"use strict";

/*
 * 零依赖静态服务器。本地预览和云端部署用的是同一条命令：
 *   node serve.js          默认 3000 端口
 *   node serve.js 8080     指定端口
 *
 * 为什么不用 python -m http.server：
 *   1. 这台机器上没有 Python；
 *   2. 云端容器的行为不可控，Node 是确定的；
 *   3. 这个文件同时把 MIME 类型、目录穿越防护、缓存策略写清楚了。
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 3000);
// 云端容器里必须监听 0.0.0.0，只监听 127.0.0.1 的话端口转发拿不到流量。
const HOST = process.env.HOST || "0.0.0.0";

/* 不对外提供的目录：部署成网站时它们没有意义。
   mcp-glm 是一个需要 API Key 的服务端程序，.impeccable 是设计过程文件。 */
const EXCLUDED = (process.env.SERVE_EXCLUDE || "mcp-glm,.impeccable,.git")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
};

function send(response, status, body, headers) {
  response.writeHead(status, Object.assign({ "Cache-Control": "no-cache" }, headers || {}));
  response.end(body);
}

function notFound(response, requestPath) {
  send(
    response,
    404,
    "<!doctype html><html lang='zh-CN'><meta charset='utf-8'>" +
      "<title>404</title>" +
      "<body style=\"margin:0;background:#F3F2EE;color:#15181B;" +
      "font-family:'Microsoft YaHei',system-ui,sans-serif;padding:64px 24px\">" +
      "<h1 style='font-size:23px;margin:0 0 12px'>404 · 找不到这个文件</h1>" +
      "<p style='color:#434A51;font-size:15px'>请求的路径：" +
      requestPath.replace(/[<&]/g, "") +
      "</p><p><a href='/' style='color:#A8331E'>回到工作台</a></p>",
    { "Content-Type": "text/html; charset=utf-8" }
  );
}

const server = http.createServer((request, response) => {
  let decoded;
  try {
    // 先解码再判路径，否则 %2e%2e%2f 这类编码能绕过下面的检查。
    decoded = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    send(response, 400, "Bad Request", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  const resolved = path.resolve(ROOT, "." + decoded);
  const insideRoot = resolved === ROOT || resolved.startsWith(ROOT + path.sep);
  const relative = path.relative(ROOT, resolved);
  const blocked =
    !insideRoot ||
    EXCLUDED.some((name) => relative === name || relative.startsWith(name + path.sep));

  if (blocked) {
    // 目录穿越和不对外暴露的目录，一律当作不存在，不给"这里有个东西但不能给你"的提示。
    console.log(`404  ${request.method} ${decoded}`);
    notFound(response, decoded);
    return;
  }

  fs.stat(resolved, (error, stats) => {
    let filePath = resolved;
    if (!error && stats.isDirectory()) filePath = path.join(resolved, "index.html");
    else if (error && !path.extname(resolved)) filePath = resolved + ".html";

    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        console.log(`404  ${request.method} ${decoded}`);
        notFound(response, decoded);
        return;
      }
      const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      console.log(`200  ${request.method} ${decoded}  ${type.split(";")[0]}  ${data.length}B`);
      if (request.method === "HEAD") {
        send(response, 200, "", { "Content-Type": type, "Content-Length": data.length });
        return;
      }
      send(response, 200, data, { "Content-Type": type, "Content-Length": data.length });
    });
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用。换一个：node serve.js ${PORT + 1}`);
  } else {
    console.error("服务器启动失败：", error);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`机械工程师工作台已启动：http://localhost:${PORT}`);
  console.log(`监听 ${HOST}:${PORT}（云端端口转发需要这个地址）`);
  console.log(`根目录：${ROOT}`);
  if (EXCLUDED.length) console.log(`不对外提供：${EXCLUDED.join("、")}`);
  console.log("按 Ctrl+C 停止。");
});
