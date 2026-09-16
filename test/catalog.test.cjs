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
