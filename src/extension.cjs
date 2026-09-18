const vscode = require("vscode");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const {
  scan,
  search,
  filesFor,
  installed,
  expandHome,
  contractHome,
  exportSkills,
  importPlan,
  listSection,
  skippedSummary,
  CATEGORIES,
  README_URL,
} = require("./catalog.cjs");
const { runImport } = require("./cli.cjs");

class Explorer {
  constructor(context) {
    this.context = context;
    this.catalog = { entries: [] };
    this.generation = 0;
    this.searchGeneration = 0;
    this.allowed = new Map();
    this.channel = vscode.window.createOutputChannel("AI Global Explorer");
    context.subscriptions.push(this.channel);
  }
  async resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };
    const nonce = crypto.randomBytes(18).toString("hex");
    const uri = (name) =>
      view.webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "media", name),
      );
    view.webview.html = (
      await fs.readFile(
        path.join(this.context.extensionPath, "media/view.html"),
        "utf8",
      )
    )
      .replaceAll("{{csp}}", view.webview.cspSource)
      .replaceAll("{{nonce}}", nonce)
      .replaceAll("{{readme}}", README_URL)
      .replace("{{style}}", uri("style.css"))
      .replace("{{script}}", uri("view.js"));
    view.webview.onDidReceiveMessage(
      (message) =>
        this.receive(message).catch((error) =>
          this.post({ type: "error", message: error.message }),
        ),
      null,
      this.context.subscriptions,
    );
    view.onDidDispose(
      () => {
        this.view = undefined;
        this.searchGeneration++;
      },
      null,
      this.context.subscriptions,
    );
  }
  post(message) {
    return this.view?.webview.postMessage(message);
  }
  async refresh() {
    const generation = ++this.generation;
    this.searchGeneration++;
    this.allowed.clear();
    this.catalog = { entries: [] };
    this.post({ type: "loading" });
    const root = vscode.workspace
      .getConfiguration("aiGlobal")
      .get("rootPath", "~/.ai-global");
    this.root = expandHome(root);
    try {
      if (!(await installed(root))) {
        if (generation !== this.generation) return;
        this.post({
          type: "missing",
          root: contractHome(this.root),
          rootPath: this.root,
        });
        this.warnMissing(contractHome(this.root));
        return;
      }
      const catalog = await scan(root);
      if (generation !== this.generation) return;
      this.catalog = catalog;
      for (const entry of catalog.entries) this.allowed.set(entry.file, 0);
      this.post({
        type: "catalog",
        ...catalog,
        root: contractHome(catalog.root),
        rootPath: catalog.root,
        categories: CATEGORIES,
      });
    } catch (error) {
      if (generation === this.generation)
        this.post({
          type: "error",
          message: `無法讀取 ai-global：${error.message}。請用「資料夾」設定來源。`,
        });
    }
  }
  // 每次啟動只跳一次通知，避免使用者按「重新整理」時重複被打斷；面板內的指引常駐。
  warnMissing(root) {
    if (this.warned) return;
    this.warned = true;
    vscode.window
      .showWarningMessage(
        `找不到 ai-global：${root} 不存在或不是 ai-global 資料夾。請先安裝 ai-global，或在設定中指定來源。`,
        "查看安裝說明",
        "開啟設定",
      )
      .then((choice) => {
        if (choice === "查看安裝說明") return this.openReadme();
        if (choice === "開啟設定") return this.openSettings();
      });
  }
  openReadme() {
    return vscode.env.openExternal(vscode.Uri.parse(README_URL));
  }
  openSettings() {
    return vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "aiGlobal.rootPath",
    );
  }
  openRoot() {
    if (!this.root) return;
    return vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(this.root),
      { forceNewWindow: true },
    );
  }
  async exportSkills(target) {
    if (!this.catalog.entries.length) {
      vscode.window.showWarningMessage("尚未讀到 ai-global 資料，無法匯出。");
      return;
    }
    target ??= await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(os.homedir(), "ai-global-skills.json"),
      ),
      filters: { JSON: ["json"] },
      saveLabel: "匯出",
    });
    if (!target) return;
    const data = exportSkills(this.catalog);
    await fs.writeFile(target.fsPath, JSON.stringify(data, null, 2) + "\n");
    vscode.window
      .showInformationMessage(
        `已匯出 ${data.skills.length} 個 skill 到 ${contractHome(target.fsPath)}`,
        "開啟檔案",
      )
      .then((choice) => {
        if (choice) return vscode.window.showTextDocument(target);
      });
    return target.fsPath;
  }
  // CLI 固定操作 $HOME/.ai-global，來源改到別處時匯入會裝錯地方，直接拒絕。
  async importSkills(source) {
    if (this.importing) return { error: "匯入進行中" };
    const home = path.join(os.homedir(), ".ai-global");
    const same =
      this.root &&
      (await fs.realpath(this.root).catch(() => "")) ===
        (await fs.realpath(home).catch(() => home));
    if (!same) {
      const error = `匯入只支援 ~/.ai-global（ai-global CLI 固定操作家目錄），目前來源為 ${contractHome(this.root || "")}。`;
      vscode.window.showErrorMessage(error);
      return { error };
    }
    source ??= (
      await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { JSON: ["json"] },
        openLabel: "匯入",
      })
    )?.[0];
    if (!source) return;
    let plan;
    try {
      plan = importPlan(
        JSON.parse(await fs.readFile(source.fsPath, "utf8")),
        this.catalog,
      );
    } catch (error) {
      vscode.window.showErrorMessage(`無法匯入：${error.message}`);
      return { error: error.message };
    }
    const skipped = skippedSummary(plan.skipped);
    if (!plan.repos.length && !plan.disable.length && !plan.enable.length) {
      vscode.window.showInformationMessage(
        ["沒有可匯入的項目。", skipped].filter(Boolean).join(" "),
      );
      return { plan };
    }
    // 覆蓋會刪掉既有 skill 目錄（含未推回 GitHub 的本機修改），必須由使用者明確選擇，不再自動答 y。
    const overwriteLabel = "匯入並覆蓋既有 skill";
    const installOnlyLabel = plan.overwrite.length
      ? "只安裝新的 skill"
      : "匯入";
    const choice = await vscode.window.showWarningMessage(
      `匯入 ${plan.repos.length} 個 repo 的 skill？`,
      {
        modal: true,
        detail: [
          listSection("安裝 repo（add-skill）", plan.repos),
          listSection("可能被覆蓋的既有 skill", plan.overwrite),
          listSection("停用", plan.disable),
          listSection("啟用", plan.enable),
          skipped,
          plan.overwrite.length
            ? `「${overwriteLabel}」會以 repo 內容取代上列既有 skill；「${installOnlyLabel}」會略過它們。最後執行 relink，不會刪除任何 skill。`
            : "會執行 ai-global add-skill 並 relink，不會刪除任何 skill。",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      ...(plan.overwrite.length ? [overwriteLabel] : []),
      installOnlyLabel,
    );
    if (choice !== overwriteLabel && choice !== installOnlyLabel)
      return { plan };
    const overwrite = choice === overwriteLabel;
    this.importing = true;
    let steps = [];
    try {
      this.channel.clear();
      this.channel.show(true);
      steps = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "AI Global：匯入 skill",
          cancellable: true,
        },
        (progress, token) =>
          runImport(plan, {
            root: this.root,
            overwrite,
            cancelled: () => token.isCancellationRequested,
            log: (text) => {
              this.channel.append(text);
              const command = text.match(/^\n\$ (.+)\n$/);
              if (command) progress.report({ message: command[1] });
            },
          }),
      );
    } catch (error) {
      vscode.window.showErrorMessage(`匯入失敗：${error.message}`);
      return { error: error.message, plan };
    } finally {
      this.importing = false;
      await this.refresh();
    }
    const failed = steps.filter((step) => !step.skipped && step.code !== 0);
    const skippedSteps = steps.filter((step) => step.skipped);
    const skippedText = skippedSteps.length
      ? `略過 ${skippedSteps.length} 個狀態同步（${skippedSteps.map((step) => `${step.args.join(" ")}：${step.skipped}`).join("；")}）。`
      : "";
    if (failed.length)
      vscode.window
        .showWarningMessage(
          `匯入完成，但 ${failed.length} 個步驟失敗：${failed.map((step) => step.args.join(" ")).join("；")}${skippedText}`,
          "查看輸出",
        )
        .then((choice) => choice && this.channel.show());
    else
      vscode.window.showInformationMessage(
        `已匯入 ${plan.repos.length} 個 repo 的 skill${plan.overwrite.length && !overwrite ? "（未覆蓋既有 skill）" : ""}，投影已重建。${skippedText}${skipped}`,
      );
    return { plan, steps };
  }
  async receive(message) {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "openReadme") return this.openReadme();
    if (message.type === "ready" || message.type === "refresh")
      return this.refresh();
    if (message.type === "settings") return this.openSettings();
    if (message.type === "openRoot") return this.openRoot();
    if (message.type === "exportSkills") return this.exportSkills();
    if (message.type === "importSkills") return this.importSkills();
    if (message.type === "detail") {
      const entry = this.catalog.entries.find((item) => item.id === message.id);
      if (!entry) return;
      const generation = this.generation;
      const listed = await filesFor(entry);
      if (generation !== this.generation) return;
      for (const file of listed.files) this.allowed.set(file, 0);
      this.post({
        type: "detail",
        entry,
        files: listed.files.map((file) => ({
          file,
          label: path.relative(
            entry.directory || path.dirname(entry.file),
            file,
          ),
        })),
        warnings: listed.warnings,
      });
    }
    if (message.type === "search") {
      const generation = ++this.searchGeneration;
      if (
        typeof message.query !== "string" ||
        !["name", "content"].includes(message.mode)
      )
        return;
      const result = await search(
        this.catalog.entries,
        message,
        () => generation !== this.searchGeneration,
      );
      if (generation !== this.searchGeneration) return;
      for (const hit of result.results) this.allowed.set(hit.file, 0);
      this.post({ type: "results", requestId: message.requestId, ...result });
    }
    if (message.type === "open" && this.allowed.has(message.file)) {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(message.file),
      );
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });
      if (Number.isSafeInteger(message.line) && message.line > 0) {
        const position = new vscode.Position(
          Math.min(message.line - 1, document.lineCount - 1),
          0,
        );
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter,
        );
      }
    }
  }
}
function activate(context) {
  const explorer = new Explorer(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("aiGlobal.explorer", explorer),
    vscode.commands.registerCommand("aiGlobal.open", () =>
      vscode.commands.executeCommand("aiGlobal.explorer.focus"),
    ),
    vscode.commands.registerCommand("aiGlobal.refresh", () =>
      explorer.refresh(),
    ),
    vscode.commands.registerCommand("aiGlobal.exportSkills", () =>
      explorer.exportSkills(),
    ),
    vscode.commands.registerCommand("aiGlobal.importSkills", () =>
      explorer.importSkills(),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("aiGlobal.rootPath")) explorer.refresh();
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (explorer.allowed.has(document.uri.fsPath)) explorer.refresh();
    }),
  );
  return explorer;
}
module.exports = { activate };
