@echo off
rem 由 Windows 工作排程器呼叫：切到專案目錄、以 node 執行已建置的 watcher
cd /d "%~dp0.."
if not exist dist\src\cli.js (
  call npm run build
)
node --no-warnings=ExperimentalWarning dist\src\cli.js watch %*
