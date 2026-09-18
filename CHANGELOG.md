# Changelog

## Unreleased

- README 的「匯出 skill」JSON 範例改用通用佔位路徑 `example-org/example-skills`。

## 0.1.10 — 2026-09-17

- README 安裝說明改為 Marketplace 優先，VSIX 為離線備案，不再寫死版號；移除開發期的本機掃描紀錄。
- 新增本檔案。

## 0.1.9 — 2026-09-17

- 「設定」下拉新增「匯出 skill」與「匯入 skill」，另提供命令 `AI Global: 匯出 skill 來源 (JSON)`／`AI Global: 匯入 skill 來源 (JSON)`。
- 匯出：把目前掃描到的 skill 清單（名稱、`v-skills/` 相對路徑、`source.md` 來源、啟用狀態）寫成 JSON，預設 `~/ai-global-skills.json`；沒有來源紀錄的 skill 仍列出以便盤點。
- 匯入：依 JSON 執行 `ai-global add-skill`（以 repo 為單位）、同步 `disable`／`enable`，最後 `relink`；執行前以 modal 列出計畫，輸出寫到 Output 面板「AI Global Explorer」，完成後自動重新整理。只新增或覆蓋，不刪除任何 skill。
- 只有 `aiGlobal.rootPath` 指向 `~/.ai-global` 時才能匯入，因為 ai-global CLI 固定操作該目錄。
- 測試新增 `test/cli.test.cjs`，以假的 `ai-global` 腳本驗證呼叫順序與答案流。

## 0.1.8 — 2026-09-16

- 加入 Marketplace 用的擴充圖示（`resources/icon.png`）並整理 `.vscodeignore` 打包範圍。

## 0.1.7 — 2026-09-16

- 啟動時偵測 ai-global 是否安裝；未安裝時面板顯示警告與安裝說明連結，並跳一次通知。
- 分類、狀態、搜尋方式、範圍四個篩選欄位加上 tooltip。
- 狀態篩選只在分類為 Skills 時列出啟用／停用／未投影，其他分類固定「全部狀態」。
- 內容區改為只顯示 metadata 表格，原文改由「在編輯器開啟原始檔」查看。
- 「資料夾」「設定」合併為「設定」下拉，顯示目前資料來源路徑（家目錄縮成 `~`），「開啟資料夾」改為在新視窗開啟。
- 側邊欄為上下三列；底側 Panel（760 px 以上）改為「篩選控制項｜清單｜內容」三欄，各欄獨立捲動。
- README 開頭補上 ai-global 簡介與連結。

## 0.1.0 — 2026-09-15

- 初版：在 Activity Bar 瀏覽本機 ai-global 的 Skills、Agents、Commands、Rules、全域指示與設定檔，查看 metadata、開啟原始檔與附屬檔案，依分類／狀態／範圍搜尋檔名或內文並跳到命中行。
