# AI Global Explorer

在 VS Code 瀏覽本機 ai-global 資源，快速查看用途與 metadata，搜尋檔名／內文，並在編輯器開啟原始檔。

## 關於 ai-global

[ai-global](https://github.com/lazyjerry/ai-global) 是統一管理 AI 工具設定的 CLI。它把 skills、agents、commands、rules 與全域指示（`AGENTS.md`）集中放在 `~/.ai-global/`，再以 symlink 投影到 Claude Code、Codex CLI、Copilot CLI、Antigravity、OpenCode 等工具的設定目錄，讓同一份資源在各工具間共用。skill 可從 GitHub 安裝到 `v-skills/`，經 `skills/` 投影層提供給各工具，並能個別停用。

本擴充讀取這個中央目錄；只有「匯入 skill」會執行 ai-global 指令。請先依上述連結的 README 安裝 ai-global。

## 安裝與使用

1. 在 VS Code 的 Extensions 面板搜尋 **AI Global Explorer**（發行者 `workjerry`）安裝，之後由 VS Code 自動更新；離線環境可執行 `Extensions: Install from VSIX...` 選擇下載的 `ai-global-explorer-<版本>.vsix`。
2. 點左側 Activity Bar 的 **AI Global**，或執行 `AI Global: 開啟資源瀏覽器`。
3. 預設讀取 `~/.ai-global`。按「設定」下拉可查看目前資料來源路徑（家目錄顯示為 `~`）、「開啟資料夾」在新的 VS Code 視窗開啟該目錄、「開啟設定」編輯 `aiGlobal.rootPath` 切換來源，以及「匯出 skill」「匯入 skill」（見下節）。「重新整理」重新掃描資料。
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

## 匯出與匯入 skill

「設定」下拉的「匯出 skill」「匯入 skill」，或命令 `AI Global: 匯出 skill 來源 (JSON)`／`AI Global: 匯入 skill 來源 (JSON)`。只處理 Skills：ai-global 只有 `add-skill` 能依來源紀錄重裝，Agents、Commands、Rules 與全域指示沒有對應指令。

**匯出**把目前掃描到的 skill 清單寫成 JSON（預設 `~/ai-global-skills.json`），依 `path` 排序：

```json
{
  "format": "ai-global-explorer/skills",
  "version": 1,
  "exportedAt": "2026-09-16T10:00:00.000Z",
  "root": "~/.ai-global",
  "skills": [
    {
      "name": "add-purpose-comment",
      "path": "example-org/example-skills/add-purpose-comment",
      "repo": "https://github.com/example-org/example-skills",
      "status": "啟用"
    },
    {
      "name": "bu-ketao",
      "path": "manual/bu-ketao",
      "repo": null,
      "status": "啟用"
    }
  ]
}
```

`path` 是 `v-skills/` 相對路徑，`repo` 來自 `source.md`；沒有安裝紀錄的 skill（例如 `manual/`）為 `null`，匯出仍列出以便盤點，但無法匯入。

**匯入**讀取這種 JSON，先以 modal 列出將安裝的 repo 與狀態變更，確認後依序執行 ai-global CLI，輸出顯示在 Output 面板的「AI Global Explorer」，完成後自動重新整理：

1. 每個不重複的 `repo` 執行 `ai-global add-skill <repo>`，「是否安裝」「是否覆蓋」都回答 y：**只新增或覆蓋，不刪除任何 skill**。同一個 repo 內 JSON 沒列到的 skill 也會一併安裝（CLI 以 repo 為單位）。
2. JSON 標「停用」而本機不是停用者執行 `ai-global disable <path>`；JSON 標「啟用」而本機停用者執行 `ai-global enable <path>`。JSON 沒列的 skill 不動；「未投影」不做任何事。
3. 最後執行 `ai-global relink` 重新投影到各工具。

限制：ai-global CLI 固定操作 `~/.ai-global`，所以只有 `aiGlobal.rootPath` 指向 `~/.ai-global` 時才能匯入。執行檔優先使用根目錄裡的 `ai-global`，否則取 PATH 上的 `ai-global`；需要 `git` 可用。既有 skill 會被 repo 內容覆蓋，`v-skills/` 裡未推回 GitHub 的本機修改會遺失。被「整個分類停用」規則涵蓋的 skill 無法單獨啟用，該步驟會失敗並列在完成訊息中。

## 搜尋與更新

- 檔名搜尋包含相對路徑及項目名稱；內文搜尋是**不分大小寫的字面比對**，不使用正規表示式。
- Skill 搜尋包含 `scripts/`、`references/`、`templates/` 等附屬檔案。遇到 `SKILL.md` 所屬目錄後，不將內部範例再列為獨立 skill。
- 單一檔案的 metadata 與內文搜尋上限為 **1 MiB**，二進位檔會略過並提示；仍可從檔案清單交給 VS Code 開啟。
- 搜尋最多 **300 筆結果**，達上限時提示縮小範圍。內文只在提交搜尋後讀取，新查詢會取消舊查詢結果。
- 排除 `.git`、`node_modules`、`backups`、`out`、`.DS_Store` 與 `.bak`／`.bak-*`。未列入的根目錄資料夾（例如管理用 `docs/`）不另外遞迴索引。
- 儲存在此面板開啟／收錄的檔案後會更新；ai-global CLI 或其他程式修改檔案後，按「重新整理」。
- 清單與 metadata 保存在記憶體，不寫回 ai-global；編輯原始檔時由 VS Code 正常儲存。本擴充不執行 skill 或 agent；ai-global CLI 只在「匯入 skill」時執行。
- `extensionKind: ui`：在 Remote Development 視窗讀取本機 ai-global 資料。

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

- `test` 另以假的 `ai-global` bash 腳本驗證 CLI 呼叫順序、非 tty 下的固定答案流與 ANSI 剝除。
- `test:ui` 使用本機 Chrome 與模擬的 VS Code message bridge，驗證分類、metadata 表格、名稱安全顯示、搜尋、過期結果、開檔訊息、匯出／匯入按鈕及 360／1000 px 排版。
- `test:integration` 使用獨立暫存 profile，驗證真實 VS Code extension 啟動、View 註冊、掃描、匯出寫檔、非 `~/.ai-global` 來源拒絕匯入、開檔與跳行。macOS 使用 `/Applications/Visual Studio Code.app`，其他平台由 `@vscode/test-electron` 取得 runtime。

發版前跑完上述指令，再以 `code --install-extension <vsix> --force` 裝進每個 profile 驗證。版本變更記在 [CHANGELOG.md](CHANGELOG.md)。

介面使用 VS Code 的 [Webview View API](https://code.visualstudio.com/api/extension-guides/webview)，遵守 Content Security Policy，以純文字呈現外部檔案內容。
