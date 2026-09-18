const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  scan,
  search,
  metadata,
  readText,
  installed,
  contractHome,
  exportSkills,
  importPlan,
  githubRepo,
  listSection,
  skippedSummary,
  SKILLS_FORMAT,
} = require("../src/catalog.cjs");
async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "aig-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const put = async (name, content) => {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    return file;
  };
  return { root, put };
}
test("合併投影、保留同名不同來源、分類停用與 system skill；不把範例當成 skill", async (t) => {
  const { root, put } = await fixture(t);
  await put(
    "v-skills/author/repo/group/tool/SKILL.md",
    "---\nname: Example\ndescription: >-\n  第一行\n  第二行\nmetadata:\n  version: 2\n---\nBody",
  );
  await put(
    "v-skills/author/repo/group/tool/references/sample/SKILL.md",
    "sample",
  );
  await put("v-skills/other/repo/tool/SKILL.md", "# Another");
  await put("v-skills/unlinked/SKILL.md", "not projected");
  await put("skills/.system/builtin/SKILL.md", "builtin");
  await fs.symlink(
    "../v-skills/author/repo/group/tool",
    path.join(root, "skills/tool"),
  );
  await fs.symlink("missing", path.join(root, "skills/broken"));
  await put("disable-skills.md", "other/repo/ # 分類停用\n");
  await put(
    "source.md",
    `https://example.com/repo|skill|${path.join(root, "v-skills/author/repo/group/tool")}\n`,
  );
  await put(
    "agents/helper.agent.md",
    "---\nname: Helper\ntools: [read, search]\n---\nAgent body",
  );
  await put("commands/find.md", "Command");
  await put("rules/default.rules", "Rule");
  await put("AGENTS.md", "Global");
  await fs.symlink("../AGENTS.md", path.join(root, "rules/AGENTS.md"));
  await put("backups/old.md", "excluded");
  await put("source.md.bak", "excluded");
  const catalog = await scan(root);
  const skills = catalog.entries.filter((entry) => entry.category === "Skills");
  assert.equal(skills.length, 4);
  const projected = skills.find((entry) => entry.name === "Example");
  assert.equal(projected.status, "啟用");
  assert.equal(projected.description, "第一行 第二行");
  assert.equal(projected.source, "https://example.com/repo");
  assert.equal(projected.meta.metadata.version, 2);
  assert.equal(
    skills.find((entry) => entry.relative.includes("other/repo")).status,
    "停用",
  );
  assert.equal(
    skills.find((entry) => entry.relative.includes("unlinked")).status,
    "未投影",
  );
  assert.equal(
    skills.find((entry) => entry.relative.includes(".system")).status,
    "啟用",
  );
  assert.equal(
    catalog.entries.some(
      (entry) =>
        entry.relative.includes("backups") || entry.relative.endsWith(".bak"),
    ),
    false,
  );
  assert.equal(
    catalog.entries.filter((entry) => entry.category === "全域指示").length,
    1,
  );
  assert.equal(
    catalog.entries.filter((entry) => entry.category === "Rules").length,
    1,
  );
  assert.equal(
    catalog.warnings.some((warning) => warning.includes("broken")),
    true,
  );
  assert.deepEqual(
    new Set(catalog.entries.map((entry) => entry.category)),
    new Set([
      "Skills",
      "Agents",
      "Commands",
      "Rules",
      "全域指示",
      "設定與其他",
    ]),
  );
});
test("附屬檔案搜尋、大小寫不敏感、行號、範圍、循環連結、二進位檔", async (t) => {
  const { root, put } = await fixture(t);
  await put("skills/demo/SKILL.md", "---\nname: Demo\n---\nMain");
  const reference = await put(
    "skills/demo/references/guide.md",
    "first\nUnique NEEDLE\nlast",
  );
  await put("skills/demo/binary.dat", Buffer.from([0, 1, 2]));
  await put("agents/helper.md", "needle outside scope");
  await fs.symlink("..", path.join(root, "skills/demo/references/loop"));
  const { entries } = await scan(root);
  const found = await search(entries, {
    query: "needle",
    category: "Skills",
    mode: "content",
  });
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].file, reference);
  assert.equal(found.results[0].line, 2);
  assert.ok(found.warnings.some((warning) => warning.includes("二進位")));
  const named = await search(entries, { query: "GUIDE", mode: "name" });
  assert.equal(named.results[0].file, reference);
  const skill = entries.find((entry) => entry.category === "Skills");
  assert.equal(
    (
      await search(entries, {
        query: "needle",
        mode: "content",
        entryId: skill.id,
      })
    ).results.length,
    1,
  );
  assert.equal(
    (
      await search(entries, {
        query: "needle",
        mode: "content",
        status: "停用",
      })
    ).results.length,
    0,
  );
  assert.equal(
    (await search(entries, { query: "needle", mode: "content" }, () => true))
      .results.length,
    0,
  );
});
test("搜尋上限與過大檔案明確回報", async (t) => {
  const { root, put } = await fixture(t);
  await put("commands/many.md", "hit\n".repeat(400));
  const large = await put("commands/large.md", "x".repeat(1024 * 1024 + 1));
  await assert.rejects(readText(large), /1 MiB/);
  const catalog = await scan(root);
  const found = await search(catalog.entries, {
    query: "hit",
    mode: "content",
  });
  assert.equal(found.results.length, 300);
  assert.equal(found.truncated, true);
});
test("無效 YAML 不阻擋原文與缺少來源根目錄可診斷", async () => {
  assert.ok(metadata("---\nname: [broken\n---\nContent", "fallback").warning);
  assert.equal(
    metadata("---\r\nname: 中文\r\n---\r\ntext", "fallback").name,
    "中文",
  );
  await assert.rejects(
    scan(path.join(os.tmpdir(), "aig-does-not-exist-" + Date.now())),
    /ENOENT/,
  );
});
test("安裝偵測：根目錄不存在、空資料夾或一般檔案都視為未安裝，含任一標記即為已安裝", async (t) => {
  const { root, put } = await fixture(t);
  assert.equal(
    await installed(path.join(os.tmpdir(), "aig-missing-" + Date.now())),
    false,
  );
  assert.equal(await installed(root), false);
  const file = await put("note.txt", "not a root");
  assert.equal(await installed(file), false);
  await put("agents/example.md", "# agent");
  assert.equal(await installed(root), true);
  assert.equal(
    contractHome(path.join(os.homedir(), ".ai-global")),
    "~/.ai-global",
  );
  assert.equal(contractHome(os.homedir()), "~");
  assert.equal(
    contractHome(os.homedir() + "-other/x"),
    os.homedir() + "-other/x",
  );
});
test("匯出只含 Skills 並依 path 排序；匯入計畫依 repo 去重、依本機狀態推導 disable／enable、略過無來源者", async (t) => {
  const { root, put } = await fixture(t);
  await put("v-skills/a/b/group/one/SKILL.md", "---\nname: One\n---");
  await put("v-skills/a/b/two/SKILL.md", "---\nname: Two\n---");
  await put("v-skills/c/d/three/SKILL.md", "---\nname: Three\n---");
  await put("v-skills/manual/local/SKILL.md", "---\nname: Local\n---");
  await put("skills/.system/builtin/SKILL.md", "builtin");
  await fs.symlink("../v-skills/a/b/two", path.join(root, "skills/two"));
  await fs.symlink("../v-skills/manual/local", path.join(root, "skills/local"));
  await put("disable-skills.md", "c/d/three\n");
  await put(
    "source.md",
    [
      `https://github.com/a/b|skill|${path.join(root, "v-skills/a/b/group/one")}`,
      `https://github.com/a/b|skill|${path.join(root, "v-skills/a/b/two")}`,
      `https://github.com/c/d|skill|${path.join(root, "v-skills/c/d/three")}`,
    ].join("\n") + "\n",
  );
  await put("agents/helper.md", "agent");
  const catalog = await scan(root);
  const exported = exportSkills(catalog);
  assert.equal(exported.format, SKILLS_FORMAT);
  assert.equal(exported.version, 1);
  assert.deepEqual(
    exported.skills.map((skill) => [
      skill.path,
      skill.name,
      skill.repo,
      skill.status,
    ]),
    [
      ["", "builtin", null, "啟用"],
      ["a/b/group/one", "One", "https://github.com/a/b", "未投影"],
      ["a/b/two", "Two", "https://github.com/a/b", "啟用"],
      ["c/d/three", "Three", "https://github.com/c/d", "停用"],
      ["manual/local", "Local", null, "啟用"],
    ],
  );
  assert.throws(() => importPlan({ format: "other" }, catalog), /格式/);
  assert.throws(() => importPlan({ ...exported, version: 2 }, catalog), /版本/);
  // 同一份匯出再匯入：狀態一致，不需要 disable／enable。
  assert.deepEqual(importPlan(exported, catalog), {
    repos: ["https://github.com/a/b", "https://github.com/c/d"],
    overwrite: ["a/b/group/one", "a/b/two", "c/d/three"],
    disable: [],
    enable: [],
    skipped: [
      { name: "builtin", path: "", reason: "沒有 GitHub 來源" },
      { name: "Local", path: "manual/local", reason: "沒有 GitHub 來源" },
    ],
  });
  const changed = {
    ...exported,
    skills: [
      {
        name: "Two",
        path: "a/b/two",
        repo: "https://github.com/a/b",
        status: "停用",
      },
      {
        name: "Three",
        path: "c/d/three",
        repo: "https://github.com/c/d",
        status: "啟用",
      },
      {
        name: "New",
        path: "e/f/new",
        repo: "https://github.com/e/f",
        status: "停用",
      },
      {
        name: "Stay",
        path: "e/f/stay",
        repo: "https://github.com/e/f",
        status: "未投影",
      },
      null,
    ],
  };
  assert.deepEqual(importPlan(changed, catalog), {
    repos: [
      "https://github.com/a/b",
      "https://github.com/c/d",
      "https://github.com/e/f",
    ],
    overwrite: ["a/b/group/one", "a/b/two", "c/d/three"],
    disable: ["a/b/two", "e/f/new"],
    enable: ["c/d/three"],
    skipped: [],
  });
  // 只含 a/b 的匯入檔不會把 c/d 的既有 skill 列為覆蓋對象。
  assert.deepEqual(
    importPlan({ ...exported, skills: [changed.skills[0]] }, catalog).overwrite,
    ["a/b/group/one", "a/b/two"],
  );
});
test("匯入計畫在延伸模組端驗證 repo 與 path，不合法項目略過並附原因", async (t) => {
  const { root, put } = await fixture(t);
  await put("v-skills/a/b/group/one/SKILL.md", "---\nname: One\n---");
  await put(
    "source.md",
    `https://github.com/a/b|skill|${path.join(root, "v-skills/a/b/group/one")}\n`,
  );
  const catalog = await scan(root);
  const skill = (name, repo, skillPath, status = "停用") => ({
    name,
    repo,
    path: skillPath,
    status,
  });
  const plan = importPlan(
    {
      format: SKILLS_FORMAT,
      version: 1,
      skills: [
        skill("ok", "https://github.com/x/y", "x/y/ok"),
        skill("evil-host", "https://evil.example/x/y", "x/y/a"),
        skill("sub-path", "https://github.com/x/y/tree/main/z", "x/y/a"),
        skill("dot-repo", "https://github.com/x/..", "x/../a"),
        skill("newline", "https://github.com/x/y\nrelink", "x/y/a"),
        skill("bare-name", "https://github.com/x/y", "pdf"),
        skill("other-repo", "https://github.com/x/y", "a/b/group/one"),
        skill("traversal", "https://github.com/x/y", "x/y/../../a/b/one"),
        skill("whole-repo", "https://github.com/x/y", "x/y"),
        skill("local-bucket", "https://github.com/a/b", "a/b/group"),
        skill("json-bucket", "https://github.com/x/y", "x/y/bucket"),
        skill("in-bucket", "https://github.com/x/y", "x/y/bucket/leaf", "啟用"),
        skill("fake\n• 列", 123, ""),
      ],
    },
    catalog,
  );
  assert.deepEqual(plan.repos, ["https://github.com/x/y"]);
  assert.deepEqual(plan.disable, ["x/y/ok"]);
  assert.deepEqual(plan.enable, []);
  assert.deepEqual(plan.overwrite, []);
  assert.deepEqual(
    plan.skipped.map((item) => [item.name, item.reason]),
    [
      ["evil-host", "repo 不是合法的 GitHub 倉庫"],
      ["sub-path", "repo 不是合法的 GitHub 倉庫"],
      ["dot-repo", "repo 不是合法的 GitHub 倉庫"],
      ["newline", "repo 不是合法的 GitHub 倉庫"],
      ["bare-name", "路徑不是該 repo 底下的 skill 路徑"],
      ["other-repo", "路徑不是該 repo 底下的 skill 路徑"],
      ["traversal", "路徑不是該 repo 底下的 skill 路徑"],
      ["whole-repo", "路徑不是該 repo 底下的 skill 路徑"],
      ["local-bucket", "路徑是分類而非單一 skill"],
      ["json-bucket", "路徑是分類而非單一 skill"],
      ["fake\n• 列", "沒有 GitHub 來源"],
    ],
  );
  // CLI 接受的三種前綴仍可用。
  for (const repo of [
    "https://github.com/a/b",
    "http://github.com/a/b",
    "github.com/a/b",
    "a/b",
  ])
    assert.equal(githubRepo(repo), "a/b");
});
test("確認視窗清單過長時截斷，名稱中的控制字元不會變成新列", () => {
  const items = Array.from({ length: 13 }, (_, i) => `x/y/s${i}`);
  const text = listSection("停用", items);
  assert.equal(text.split("\n").length, 12);
  assert.match(text, /^停用（13）：\n• x\/y\/s0\n/);
  assert.match(text, /…另 3 個$/);
  assert.equal(listSection("停用", []), "");
  const summary = skippedSummary([
    { name: "fake\n• 列", path: "", reason: "沒有 GitHub 來源" },
    ...items.map((name) => ({ name, path: name, reason: "r" })),
  ]);
  assert.ok(!summary.includes("\n"));
  assert.match(
    summary,
    /^略過 14 個：fake • 列（沒有 GitHub 來源）、x\/y\/s0（r）/,
  );
  assert.match(summary, /另 4 個$/);
  assert.equal(skippedSummary([]), "");
});
test("package.json：資料根目錄只允許 machine 層級，不讀工作區所以宣告支援未受信任工作區", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  assert.equal(
    manifest.contributes.configuration.properties["aiGlobal.rootPath"].scope,
    "machine",
  );
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, true);
});
