# 顯示排程任務狀態與 watcher 健康報告
param([string]$TaskName = 'fb-line-watcher')
. "$PSScriptRoot\common.ps1"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "排程任務：$($task.State)，上次執行 $($info.LastRunTime)，上次結果 $($info.LastTaskResult)"
} else {
  Write-Host '尚未安裝排程任務（scripts\install-task.ps1）' -ForegroundColor Yellow
}
npm run health
