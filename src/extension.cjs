const vscode = require("vscode");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  scan,
  search,
  filesFor,
  installed,
  expandHome,
  contractHome,
  CATEGORIES,
  README_URL,
} = require("./catalog.cjs");

class Explorer {
  constructor(context) {
    this.context = context;
    this.catalog = { entries: [] };
    this.generation = 0;
    this.searchGeneration = 0;
    this.allowed = new Map();
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
  async receive(message) {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "openReadme") return this.openReadme();
    if (message.type === "ready" || message.type === "refresh")
      return this.refresh();
    if (message.type === "settings") return this.openSettings();
    if (message.type === "openRoot") return this.openRoot();
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
