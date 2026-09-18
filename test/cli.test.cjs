const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { locateAiGlobal, run, runImport } = require("../src/cli.cjs");
// 假的 ai-global：把參數與 read 到的答案寫進 log，並印帶 ANSI 色碼的訊息。
async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "aig-cli-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const log = path.join(root, "calls.log");
  await fs.writeFile(
    path.join(root, "ai-global"),
    `#!/bin/bash
echo "args: $*" >> "${log}"
echo "cwd: $(pwd)" >> "${log}"
printf '\\033[0;34m[INFO]\\033[0m 目錄: %s\\n' "$1"
if [[ "$1" == "add-skill" ]]; then
  read -r -p "是否安裝?[Y/n] " a
  read -r -p "是否覆蓋 x?[y/N] " b
  echo "answers: [$a] [$b]" >> "${log}"
  [[ "$2" == "https://github.com/bad/repo" ]] && exit 1
else
  read -r -p "unexpected?[y/N] " c
  echo "answers: [$c]" >> "${log}"
fi
exit 0
`,
    { mode: 0o755 },
  );
  return { root, calls: () => fs.readFile(log, "utf8") };
}
test("優先使用根目錄內的 ai-global，缺少時退回 PATH", async (t) => {
  const { root } = await fixture(t);
  assert.equal(await locateAiGlobal(root), path.join(root, "ai-global"));
  assert.equal(await locateAiGlobal(path.join(root, "nowhere")), "ai-global");
});
test("run 剝掉 ANSI 色碼並回傳結束碼", async (t) => {
  const { root, calls } = await fixture(t);
  let output = "";
  const { code } = await run(path.join(root, "ai-global"), ["relink"], {
    cwd: root,
    log: (text) => (output += text),
  });
  assert.equal(code, 0);
  assert.equal(output, "[INFO] 目錄: relink\n");
  assert.match(await calls(), /answers: \[\]/);
  await assert.rejects(
    run(path.join(root, "missing"), [], { cwd: root, log: () => {} }),
  );
});
async function skillDirs(root, ...vpaths) {
  for (const vpath of vpaths) {
    await fs.mkdir(path.join(root, "v-skills", vpath), { recursive: true });
    await fs.writeFile(path.join(root, "v-skills", vpath, "SKILL.md"), "");
  }
}
test("runImport 依序 add-skill（同意覆蓋時全答 y）、disable、enable、relink，並回報失敗步驟", async (t) => {
  const { root, calls } = await fixture(t);
  const home = path.join(root, "home");
  await fs.mkdir(home);
  await skillDirs(root, "a/b/one", "a/b/two");
  const steps = await runImport(
    {
      repos: ["https://github.com/a/b", "https://github.com/bad/repo"],
      disable: ["a/b/one"],
      enable: ["a/b/two"],
    },
    { root, home, log: () => {}, overwrite: true },
  );
  assert.deepEqual(
    steps.map((step) => [step.args.join(" "), step.code]),
    [
      ["add-skill https://github.com/a/b", 0],
      ["add-skill https://github.com/bad/repo", 1],
      ["disable a/b/one", 0],
      ["enable a/b/two", 0],
      ["relink", 0],
    ],
  );
  const log = await calls();
  assert.equal((log.match(/answers: \[y\] \[y\]/g) || []).length, 2);
  assert.equal((log.match(/answers: \[\]\n/g) || []).length, 3);
  assert.equal((log.match(new RegExp(`cwd: ${home}`, "g")) || []).length, 5);
});
test("取消後不再執行後續步驟", async (t) => {
  const { root } = await fixture(t);
  let count = 0;
  const steps = await runImport(
    { repos: ["https://github.com/a/b"], disable: [], enable: [] },
    { root, home: root, log: () => {}, cancelled: () => count++ > 0 },
  );
  assert.deepEqual(
    steps.map((step) => step.args),
    [["add-skill", "https://github.com/a/b"]],
  );
});
test("未同意覆蓋時只答「是否安裝」，覆蓋提示讀到 EOF 取預設 N", async (t) => {
  const { root, calls } = await fixture(t);
  const steps = await runImport(
    { repos: ["https://github.com/a/b"], disable: [], enable: [] },
    { root, home: root, log: () => {} },
  );
  assert.deepEqual(
    steps.map((step) => [step.args.join(" "), step.code]),
    [
      ["add-skill https://github.com/a/b", 0],
      ["relink", 0],
    ],
  );
  assert.match(await calls(), /answers: \[y\] \[\]\n/);
  assert.doesNotMatch(await calls(), /answers: \[y\] \[y\]/);
});
test("disable／enable 只作用在有 SKILL.md 的單一 skill，分類或不存在的路徑略過不呼叫 CLI", async (t) => {
  const { root, calls } = await fixture(t);
  await skillDirs(root, "a/b/bucket/leaf");
  const logged = [];
  const steps = await runImport(
    {
      repos: [],
      disable: ["a/b/bucket", "a/b/bucket/leaf"],
      enable: ["a/b/missing"],
    },
    { root, home: root, log: (text) => logged.push(text) },
  );
  assert.deepEqual(
    steps.map((step) => [
      step.args.join(" "),
      step.code,
      Boolean(step.skipped),
    ]),
    [
      ["disable a/b/bucket", null, true],
      ["disable a/b/bucket/leaf", 0, false],
      ["enable a/b/missing", null, true],
      ["relink", 0, false],
    ],
  );
  const invoked = (await calls()).match(/^args: .*$/gm);
  assert.deepEqual(invoked, ["args: disable a/b/bucket/leaf", "args: relink"]);
  assert.ok(
    logged.some((text) => text.includes("略過 ai-global disable a/b/bucket")),
  );
});
