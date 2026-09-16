const vscode = require("vscode");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
exports.run = async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "aig-data-")),
  );
  try {
    await fs.mkdir(path.join(root, "agents"));
    const file = path.join(root, "agents", "example.md");
    await fs.writeFile(
      file,
      "---\nname: Host Example\n---\nDistinctive content",
    );
    await fs.mkdir(path.join(root, "v-skills/a/b/c"), { recursive: true });
    await fs.writeFile(
      path.join(root, "v-skills/a/b/c/SKILL.md"),
      "---\nname: Host Skill\n---",
    );
    await fs.writeFile(
      path.join(root, "source.md"),
      `https://github.com/a/b|skill|${path.join(root, "v-skills/a/b/c")}\n`,
    );
    await vscode.workspace
      .getConfiguration("aiGlobal")
      .update("rootPath", root, vscode.ConfigurationTarget.Global);
    const extension = vscode.extensions.getExtension(
      "workjerry.ai-global-explorer",
    );
    assert.ok(extension);
    const explorer = await extension.activate();
    await vscode.commands.executeCommand("aiGlobal.open");
    await explorer.refresh();
    assert.equal(explorer.catalog.entries[0].name, "Host Skill");
    const exported = vscode.Uri.file(path.join(root, "export.json"));
    assert.equal(await explorer.exportSkills(exported), exported.fsPath);
    const data = JSON.parse(await fs.readFile(exported.fsPath, "utf8"));
    assert.deepEqual(data.skills, [
      {
        name: "Host Skill",
        path: "a/b/c",
        repo: "https://github.com/a/b",
        status: "未投影",
      },
    ]);
    // 來源不是 ~/.ai-global 時拒絕匯入，不會執行 CLI。
    assert.match(
      (await explorer.importSkills(exported)).error,
      /~\/\.ai-global/,
    );
    await explorer.receive({ type: "open", file, line: 4 });
    assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, file);
    assert.equal(vscode.window.activeTextEditor.selection.active.line, 3);
    await explorer.receive({
      type: "open",
      file: path.join(root, "outside.md"),
    });
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "aig-empty-"));
    const posted = [];
    explorer.post = (message) => posted.push(message);
    await vscode.workspace
      .getConfiguration("aiGlobal")
      .update("rootPath", empty, vscode.ConfigurationTarget.Global);
    // 設定變更事件會自動觸發 refresh，與手動 refresh 交錯時 missing 可能晚到，輪詢等它送出。
    for (let i = 0; i < 50 && posted.at(-1)?.type !== "missing"; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(posted.at(-1).type, "missing");
    await fs.rm(empty, { recursive: true, force: true });
    assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, file);
    console.log(
      "Extension activation, view registration, catalog, skill export, import guard, editor navigation and install detection passed.",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};
