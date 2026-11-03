# 安裝 Windows 工作排程器任務：使用者登入 Windows 後自動啟動 watcher，失敗自動重啟
param(
  [string]$TaskName = 'fb-line-watcher',
  [switch]$Headless
)
. "$PSScriptRoot\common.ps1"
Assert-Node
Assert-Config

Write-Host '建置 TypeScript…' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$cmd = Join-Path $ProjectRoot 'scripts\run-watch.cmd'
$extra = if ($Headless) { '--headless' } else { '' }
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$cmd`" $extra`"" -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT1M'
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 2) -ExecutionTimeLimit (New-TimeSpan -Days 0) -StartWhenAvailable -MultipleInstances IgnoreNew -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Facebook 粉專／社團畫面監看 → 截圖 → LINE 通知' | Out-Null
Write-Host "已建立排程任務「$TaskName」：登入 Windows 後 1 分鐘自動啟動，異常結束 2 分鐘後自動重啟。" -ForegroundColor Green
Write-Host '注意：必須以「互動登入」執行（需要看得到的瀏覽器），因此電腦需保持登入狀態；螢幕可以鎖定但不要登出。' -ForegroundColor Yellow
Write-Host '執行時會有一個黑色命令列視窗與一個瀏覽器視窗，可以縮到最小，但不要關閉。' -ForegroundColor Yellow
Write-Host "現在啟動：Start-ScheduledTask -TaskName $TaskName"
Start-ScheduledTask -TaskName $TaskName
