# 重建現況 baseline：把目前畫面上的貼文／留言全部標記為已知，不通知
. "$PSScriptRoot\common.ps1"
Assert-Node
Assert-Config
npm run baseline -- --headless
