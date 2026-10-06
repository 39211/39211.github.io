# Facebook 改版或更新 adapter 後重新同步，不把舊內容當新事件
. "$PSScriptRoot\common.ps1"
Assert-Node
Assert-Config
npm run resync -- --headless
