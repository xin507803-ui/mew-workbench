@echo off
rem glm-mcp 的 stdio 服务端启动脚本。
rem 一般不需要手动运行它——宿主（Codex / Claude Code）会自己拉起这个进程。
rem 手动运行时的用途：配合 client.js 调试，或者确认服务端能起来。
setlocal

if "%GLM_API_KEY%"=="" if "%ZHIPUAI_API_KEY%"=="" (
  echo [glm-mcp] 警告：没有设置 GLM_API_KEY，服务端能启动，但调用工具会失败。
  echo [glm-mcp] 设置方法： set GLM_API_KEY=你的key
  echo.
)

if "%GLM_MODEL%"=="" set GLM_MODEL=glm-4.6-flash

node "%~dp0server.js"
