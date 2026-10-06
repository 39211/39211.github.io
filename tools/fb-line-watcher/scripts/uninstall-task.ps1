param([string]$TaskName = 'fb-line-watcher')
. "$PSScriptRoot\common.ps1"
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "已移除排程任務「$TaskName」。若 watcher 仍在執行，請在工作管理員結束 node.exe。" -ForegroundColor Green
