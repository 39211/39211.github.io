# 開源可靠性示範

這個資料夾是 `39211/laundry-social-auto-poster` 的免金鑰公開證據頁。

## 怎麼看

命令列（不需 npm）：

```bash
node oss/oss-demo.mjs
```

或用任何靜態伺服器開這個資料夾：

```bash
python3 -m http.server 4173 --directory oss
```

然後用瀏覽器打開 `http://127.0.0.1:4173/`，按「跑全部」。頁面會在本機跑三個發布情境與 25 個回歸案例，不會讀取金鑰，也不會發到正式社群。

申請欄位在同頁與 `application.txt`。官方表單是 https://openai.com/form/codex-for-oss/ ，必須由申請人在自己的瀏覽器完成網站驗證後送出。

軟體示範是 MIT（見 `LICENSE`）。店家照片與品牌素材不在這個授權範圍。
