# AI Global Explorer

在 VS Code 瀏覽本機 ai-global 資源，快速查看用途與 metadata，搜尋檔名／內文，並在編輯器開啟原始檔。

## 關於 ai-global

[ai-global](https://github.com/lazyjerry/ai-global) 是統一管理 AI 工具設定的 CLI。它把 skills、agents、commands、rules 與全域指示（`AGENTS.md`）集中放在 `~/.ai-global/`，再以 symlink 投影到 Claude Code、Codex CLI、Copilot CLI、Antigravity、OpenCode 等工具的設定目錄，讓同一份資源在各工具間共用。skill 可從 GitHub 安裝到 `v-skills/`，經 `skills/` 投影層提供給各工具，並能個別停用。

本擴充只讀取這個中央目錄，不執行 ai-global 指令；請先依上述連結的 README 安裝 ai-global。

## 安裝與使用

1. 在 VS Code 執行 `Extensions: Install from VSIX...`，選擇 `ai-global-explorer-0.1.8.vsix`。
2. 點左側 Activity Bar 的 **AI Global**，或執行 `AI Global: 開啟資源瀏覽器`。
3. 預設讀取 `~/.ai-global`。按「設定」下拉可查看目前資料來源路徑（家目錄顯示為 `~`）、「開啟資料夾」在新的 VS Code 視窗開啟該目錄，或「開啟設定」編輯 `aiGlobal.rootPath` 切換來源。「重新整理」重新掃描資料。
   尚未安裝 ai-global（根目錄不存在，或沒有 `ai-global`、`source.md`、`skills/`、`v-skills/`、`agents/`、`commands/`、`rules/` 任一項）時，面板會顯示警告與安裝說明連結 <https://github.com/lazyjerry/ai-global#readme>，並在啟動後跳一次通知；安裝或在設定中指定資料夾後按「重新整理」即可。
4. 點選清單項目，查看 metadata 表格與檔案清單。原文不在面板內顯示，按「在編輯器開啟原始檔」，或展開「檔案」開啟附屬檔案。
5. 先選分類／狀態，再選「檔名／名稱」或「內文」，輸入關鍵字並按 Enter／搜尋。可將範圍切換為「所選項目」。點選內文結果會開啟檔案並跳到命中行。將滑鼠停在「分類」「狀態」「搜尋方式」「範圍」上會顯示各選項的說明。

放在左右側邊欄時，篩選控制項、清單、內容上下堆疊成三列；把 View 移到底側 Panel（寬度 760 px 以上），改為「篩選控制項｜清單｜內容」左中右三欄，各欄獨立捲動。

## 資源與 metadata

| 分類       | 資料來源                                     | 說明                                                           |
| ---------- | -------------------------------------------- | -------------------------------------------------------------- |
| Skills     | `v-skills/**/SKILL.md`、`skills/**/SKILL.md` | 依實體路徑合併投影，包含 `.system`，保留不同來源的同名 skill   |
| Agents     | `agents/`                                    | 支援 `.agent.md` 等一般檔案                                    |
| Commands   | `commands/`                                  | 指令提示詞與附屬檔案                                           |
| Rules      | `rules/`                                     | 規則檔案；指向根目錄全域指示的連結合併到全域指示               |
| 全域指示   | 根目錄 `AGENTS*.md`                          | 例如 `AGENTS.md`、`AGENTS-TW.md`                               |
| 設定與其他 | 根目錄其他一般檔案                           | 例如 `source.md`、`disable-skills.md`、`projects`、`ai-global` |

清單顯示名稱、用途摘要、分類、狀態與來源。詳細內容以表格顯示實體路徑、修改時間、檔案大小，以及 YAML frontmatter 的全部欄位（例如 `tools`、`model`、`license`、巢狀 `metadata`）；純量陣列以頓號串接，巢狀物件以 JSON 呈現。沒有 frontmatter 時，以檔名和首段文字提供摘要；格式錯誤會提示，原文請在編輯器開啟。

只有 Skills 有狀態篩選：分類選 Skills 時，狀態下拉列出啟用／停用／未投影；其他分類沒有啟用／停用機制，狀態欄停用並固定為「全部狀態」，清單標示為「可用」。Skills 狀態依 ai-global 的本機資料判定：

- **啟用**：實體檔案存在於 `skills/` 投影或本機 skill 目錄。
- **停用**：符合 `disable-skills.md` 的完整相對路徑，或以 `/` 結尾的分類前綴；支援 `#` 註解。
- **未投影**：存在於 `v-skills/`，但未出現在 `skills/` 且未停用。

此狀態代表 ai-global 資料狀態，不代表各 AI 工具已載入或支援該項目。來源網址由 `source.md` 的 `URL|類型|路徑` 對應取得。

## 搜尋與更新

- 檔名搜尋包含相對路徑及項目名稱；內文搜尋是**不分大小寫的字面比對**，不使用正規表示式。
- Skill 搜尋包含 `scripts/`、`references/`、`templates/` 等附屬檔案。遇到 `SKILL.md` 所屬目錄後，不將內部範例再列為獨立 skill。
- 單一檔案的 metadata 與內文搜尋上限為 **1 MiB**，二進位檔會略過並提示；仍可從檔案清單交給 VS Code 開啟。
- 搜尋最多 **300 筆結果**，達上限時提示縮小範圍。內文只在提交搜尋後讀取，新查詢會取消舊查詢結果。
- 排除 `.git`、`node_modules`、`backups`、`out`、`.DS_Store` 與 `.bak`／`.bak-*`。未列入的根目錄資料夾（例如管理用 `docs/`）不另外遞迴索引。
- 儲存在此面板開啟／收錄的檔案後會更新；ai-global CLI 或其他程式修改檔案後，按「重新整理」。
- 清單與 metadata 保存在記憶體，不寫回 ai-global；編輯原始檔時由 VS Code 正常儲存。本擴充不執行 skill、agent 或 ai-global CLI。
- `extensionKind: ui`：在 Remote Development 視窗讀取本機 ai-global 資料。

## 本機掃描紀錄

2026-09-15 開發驗證：62 Skills（56 啟用、6 停用）、6 Agents、2 Commands、1 Rules、2 全域指示、4 設定與其他；掃描無警告。實際清單與數量會隨使用者資料變更。

## 開發與驗證

需要 Node.js 20 以上。開啟此資料夾，執行 build 後按 F5 啟動 Extension Development Host。

```sh
npm ci
npm run build
npm test
npm run test:ui
npm run test:integration
npm run format:check
npm run package:vsix
```

- `test:ui` 使用本機 Chrome 與模擬的 VS Code message bridge，驗證分類、metadata 表格、名稱安全顯示、搜尋、過期結果、開檔訊息及 360／1000 px 排版。
- `test:integration` 使用獨立暫存 profile，驗證真實 VS Code extension 啟動、View 註冊、掃描、開檔與跳行。macOS 使用 `/Applications/Visual Studio Code.app`，其他平台由 `@vscode/test-electron` 取得 runtime。
- 已通過上述自動驗證；尚未在使用者日常 profile 完成人工操作驗收。

介面使用 VS Code 的 [Webview View API](https://code.visualstudio.com/api/extension-guides/webview)，遵守 Content Security Policy，以純文字呈現外部檔案內容。
