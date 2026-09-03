# 開啟專用瀏覽器讓使用者手動登入 Facebook（含雙重驗證）。程式不讀取、不儲存密碼。
. "$PSScriptRoot\common.ps1"
Assert-Node
Assert-Config
npm run login
