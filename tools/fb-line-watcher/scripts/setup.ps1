# 第一次安裝：安裝依賴、下載 Chromium、建立設定檔範本、鎖定資料夾權限
. "$PSScriptRoot\common.ps1"
Assert-Node

$warnings = @()

Write-Host '1/4 安裝 npm 依賴（依 package-lock.json 精確還原）…' -ForegroundColor Cyan
if (Test-Path 'package-lock.json') {
  Invoke-Native 'npm ci' { npm ci }
} else {
  Write-Host '  找不到 package-lock.json，改用 npm install' -ForegroundColor Yellow
  Invoke-Native 'npm install' { npm install }
}

Write-Host '2/4 下載 Playwright Chromium…' -ForegroundColor Cyan
npx playwright install chromium
if ($LASTEXITCODE -ne 0) {
  # 這一步允許失敗：targets.yaml 若把 browser.channel 設為 msedge 或 chrome 就用不到 Chromium
  $warnings += "Playwright Chromium 下載失敗（結束代碼 $LASTEXITCODE）。若 config\targets.yaml 的 browser.channel 是 msedge 或 chrome 可以忽略；否則請重跑 npx playwright install chromium。"
  Write-Host "  ! $($warnings[-1])" -ForegroundColor Yellow
}

Write-Host '3/4 建立設定檔…' -ForegroundColor Cyan
if (-not (Test-Path 'config\targets.yaml')) { Copy-Item 'config\targets.example.yaml' 'config\targets.yaml'; Write-Host '  已建立 config\targets.yaml，請填入你要監看的粉專／社團網址' }
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env'; Write-Host '  已建立 .env，請填入 LINE token 與群組 ID' }
New-Item -ItemType Directory -Force -Path 'data', 'captures' | Out-Null

Write-Host '4/4 限制 data\ 與 captures\ 只有目前使用者可讀取…' -ForegroundColor Cyan
foreach ($dir in @('data', 'captures')) {
  icacls $dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $warnings += "無法限制 $dir 的存取權限（icacls 結束代碼 $LASTEXITCODE）。截圖與資料庫可能其他本機帳號也讀得到，請手動檢查資料夾權限。"
    Write-Host "  ! $($warnings[-1])" -ForegroundColor Yellow
  }
}

Write-Host ''
if ($warnings.Count -gt 0) {
  Write-Host "安裝完成，但有 $($warnings.Count) 項警告：" -ForegroundColor Yellow
  foreach ($w in $warnings) { Write-Host "  - $w" -ForegroundColor Yellow }
  Write-Host ''
} else {
  Write-Host '安裝完成，沒有警告。' -ForegroundColor Green
}
Write-Host '下一步：' -ForegroundColor Green
Write-Host '  1. 編輯 config\targets.yaml 與 .env'
Write-Host '  2. 執行 scripts\login.ps1 手動登入 Facebook'
Write-Host '  3. 執行 npm run test-line 確認 LINE 通了'
Write-Host '  4. 執行 npm run once 建立 baseline，再用 scripts\install-task.ps1 設定開機自動執行'
Write-Host '  5. 想大幅降低帳號風險，接著看 PHONE_TRIGGER.md 設定手機通知觸發'
