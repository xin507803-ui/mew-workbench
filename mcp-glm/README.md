# glm-mcp：手写的 MCP 底层调用 GLM-4.6-Flash

零依赖。不用 npm、不用 pip、不装任何包，只用 Node 内置模块。
所有代码都在你眼前，协议是手写出来的，不是 SDK 藏起来的。

```
mcp-glm/
├─ protocol.js   JSON-RPC 2.0 + 换行分帧 + 带背压的写入器
├─ server.js     MCP 服务端（stdio），把 GLM-4.6-Flash 包成 4 个工具
├─ client.js     MCP 客户端（会 spawn 服务端），带命令行
├─ selftest.js   离线自检：起一个假 GLM 接口，跑完 27 项断言
└─ run-server.cmd  Windows 下的启动脚本
```

## 1. 先跑起来（不需要 API Key）

```powershell
cd C:\Users\陈鑫\Desktop\skill\mcp-glm
node selftest.js
```

这个自检会在本地起一个假的 GLM 接口，然后完整跑一遍握手、列工具、调工具、
参数校验、401 处理、脏输入处理。27 项全绿说明协议层是对的，之后联网出问题
就只可能是网络或 Key 的问题，不可能是协议写错。

看工具清单：

```powershell
node client.js tools
node client.js config        # 只读配置，不联网
```

## 2. 接上真实模型

先拿 Key（智谱开放平台），然后：

```powershell
$env:GLM_API_KEY = "你的key"
node client.js call glm_chat '{"prompt":"用一句话解释什么是公差堆叠"}'
```

> PowerShell 的坑：外面用单引号包住 JSON 时，里面直接写双引号即可，
> **不要**写成 `\"`——单引号里的反斜杠会被原样保留，JSON 立刻变成非法。
> 路径同理，用正斜杠 `C:/Users/...` 最省事。

想看线级报文（这一步最值得看）：

```powershell
$env:MCP_DEBUG = "1"
node client.js ping
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `GLM_API_KEY` | 无 | 必填。也兼容 `ZHIPUAI_API_KEY`。 |
| `GLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 接口前缀。换服务商只改这一个。 |
| `GLM_MODEL` | `glm-4.6-flash` | 模型名。**先跑 `client.js config` 确认，再调工具。** |
| `GLM_VISION_MODEL` | 同 `GLM_MODEL` | 看图用的模型。**必须是视觉模型**，见下面第 4 节。 |
| `GLM_VISION_ROOTS` | 当前工作目录 | 允许读图的目录，多个用分号分隔。这是安全边界，不要设成盘符根目录。 |
| `GLM_VISION_MAX_BYTES` | `8388608`（8MB） | 单张图片体积上限。 |
| `GLM_TIMEOUT_MS` | `60000` | 单次调用超时。 |
| `MCP_DEBUG` | 未设置 | 设为 `1` 打开线级日志（走 stderr）。 |

> 关于模型名：我没有联网核实过 `glm-4.6-flash` 这个具体标识在本服务商处的拼写，
> 所以它被做成可配置项。如果调用返回 HTTP 404 或「模型不存在」，
> 用 `$env:GLM_MODEL = "实际模型名"` 覆盖即可，代码不用动。

## 3. 协议到底长什么样

打开 `MCP_DEBUG=1` 之后你会看到这样的报文。stdio 传输的全部规则就是
**一条消息占一行、用 `\n` 分隔、消息体里不能有裸换行**。

第一次握手（客户端 → 服务端）：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"roots":{"listChanged":false}},"clientInfo":{"name":"mcp-glm-cli","version":"1.0.0"}}}
```

服务端回：

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false},"logging":{}},"serverInfo":{"name":"glm-mcp","title":"GLM-4.6-Flash MCP 服务端","version":"1.0.0"}}}
```

客户端确认（注意：**通知没有 id，服务端不许回复**）：

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

列工具 → 调工具：

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"glm_chat","arguments":{"prompt":"你好"}}}
```

工具成功返回：

```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"..."}]}}
```

## 4. 让模型看图（glm_vision）

```powershell
$env:MCP_DEBUG = "0"
node client.js call glm_vision '{"prompt":"这张截图里有哪些排版问题？","images":["C:/Users/陈鑫/Desktop/skill/.impeccable/review/desktop.png"]}'
```

服务端会把图片读成 base64、拼成 data URL，按下面这种多模态内容块发给模型：

```json
{
  "model": "glm-4.6-flash",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBOR..." } },
      { "type": "text", "text": "这张截图里有哪些排版问题？" }
    ]
  }]
}
```

**两件必须先知道的事：**

**① 模型必须支持视觉。**`glm-4.6-flash` 大概率是纯文本型号（智谱的视觉能力在 GLM-4V
那条线上）。所以 `glm_vision` 用的是独立的 `GLM_VISION_MODEL`，默认跟文本模型同名。
如果返回 400/404 说模型不支持图片，改成实际的视觉型号即可，代码不用动。

**② 这是"别人描述给你听"，不是你自己看。**返回的文字是模型对图片的转述，
它会漏、会编、会把两个元素看混。所以它可以用来做初筛（"这张图有没有溢出/错位/空白"），
但不能拿它当像素级证据。真正的判断还是得人眼看。

**安全边界。**`glm_vision` 会读本地文件并上传到远端接口，所以它默认只允许读
当前工作目录下的图片，路径越界直接拒绝。要放行别的目录就设 `GLM_VISION_ROOTS`，
但**不要**为了省事把它设成整个盘符——那等于给这个工具开了任意文件外传的后门。

## 5. 这个实现里最重要的三个设计决断

**① stdout 是协议专用通道。**
`server.js` 第一行就把 `console.log` 改道到 stderr。任何一句漏出去的 `console.log`
都会变成一行脏数据，客户端直接报 `-32700 解析错误`。这是新手最常踩的坑，没有之一。

**② 工具失败 ≠ 协议失败。**

- 方法不存在 → JSON-RPC error `-32601`
- 参数不合法、工具名不存在 → JSON-RPC error `-32602`
- **工具逻辑失败**（没配 Key、上游 401、模型没返回合法 JSON、超时）→
  回一个正常结果，但带 `"isError": true`，失败原因写在 text 里

区别在哪儿？JSON-RPC error 是给客户端程序看的，模型看不到；
`isError: true` 的结果会进入模型的上下文，模型能读到自己为什么失败并调整。
把这两种失败搞混，你的 MCP 就会在出错时对模型彻底失声。

**③ 请求可以并发，不必排队。**
`feed()` 里故意不 `await dispatch()`，所以一个慢的模型调用不会堵住后面的
`tools/list`。取消则靠 `notifications/cancelled` 找到对应的 `AbortController` 打断。

## 6. 接进 Codex / Claude Code

在 Codex 的 `~/.codex/config.toml` 里加一段（Claude Code 用 `claude mcp add` 或
对应的 JSON 配置，字段名类似）：

```toml
[mcp_servers.glm]
command = "node"
args = ["C:\\Users\\陈鑫\\Desktop\\skill\\mcp-glm\\server.js"]
env = { GLM_API_KEY = "你的key", GLM_MODEL = "glm-4.6-flash" }
```

重启宿主后，模型就能直接调 `glm_chat`、`glm_json`、`glm_config` 了。

## 7. 接下来可以自己加什么

按难度排序，每一个都能让你更懂 MCP：

1. **加 `resources`**：把本地文件通过 `resources/list` + `resources/read` 暴露出去，
   让宿主能读你的图纸清单或课程数据。
2. **加 `prompts`**：把常用提示词做成可在宿主里直接选的模板。
3. **加 streaming**：现在是一次性返回；改成 SSE 需要同时处理 `notifications/progress`。
4. **用 sampling 代替直连**：MCP 有一个 `sampling/createMessage` 机制，
   让**宿主的模型**来跑推理，而不是你这个服务端自己去调 HTTP。
   这才是"MCP 风格的调模型"，代价是不能指定 GLM。
5. **加鉴权与限流**：HTTP 传输下 MCP 支持 OAuth 之类的授权流程。

## 8. 已经验证过的东西

`node selftest.js` 覆盖 40 项：握手与版本协商、能力声明、工具清单与 schema、
不联网工具、完整调用链（含请求体与鉴权头断言）、合法/非法 JSON 输出、
未知工具、缺必填参数、未知方法、上游 401、服务端主动通知、非法 JSON 输入、
优雅关闭；以及看图的 13 项——内容块结构、data URL 编码与还原、图片/文字块顺序、
允许目录之外的路径被拒绝、文件不存在、格式不支持、超过体积上限。
