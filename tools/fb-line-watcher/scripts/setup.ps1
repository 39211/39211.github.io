# 第一次安裝：安裝依賴、下載 Chromium、建立設定檔範本、鎖定資料夾權限
. "$PSScriptRoot\common.ps1"
Assert-Node

Write-Host '1/4 安裝 npm 依賴…' -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '2/4 下載 Playwright Chromium（若 targets.yaml 使用 msedge/chrome 可略過失敗）…' -ForegroundColor Cyan
npx playwright install chromium

Write-Host '3/4 建立設定檔…' -ForegroundColor Cyan
if (-not (Test-Path 'config\targets.yaml')) { Copy-Item 'config\targets.example.yaml' 'config\targets.yaml'; Write-Host '  已建立 config\targets.yaml，請填入你的粉專／社團網址' }
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env'; Write-Host '  已建立 .env，請填入 LINE token 與群組 ID' }
New-Item -ItemType Directory -Force -Path 'data', 'captures' | Out-Null

Write-Host '4/4 限制 data\ 與 captures\ 只有目前使用者可讀取…' -ForegroundColor Cyan
foreach ($dir in @('data', 'captures')) {
  try {
    icacls $dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F" | Out-Null
  } catch { Write-Host "  無法設定 $dir 權限：$_" -ForegroundColor Yellow }
}
Write-Host ''
Write-Host '完成。下一步：' -ForegroundColor Green
Write-Host '  1. 編輯 config\targets.yaml 與 .env'
Write-Host '  2. 執行 scripts\login.ps1 手動登入 Facebook'
Write-Host '  3. 執行 npm run test-line 確認 LINE 通了'
Write-Host '  4. 執行 npm run once 建立 baseline，再用 scripts\install-task.ps1 設定開機自動執行'
