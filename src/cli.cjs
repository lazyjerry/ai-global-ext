const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

// bash 的 read -p 在 stdin 不是 tty 時不會印出提示，無法看到提示再回答；
// add-skill 先問一次「是否安裝 [Y/n]」，再對每個既有 skill 問「是否覆蓋 [y/N]」，
// 直接餵固定答案流，超出的提示讀到 EOF 取預設值。
// 使用者沒在確認視窗同意覆蓋時只答安裝，覆蓋提示讀到 EOF 取預設 N，既有 skill 保持原狀。
const INSTALL_ONLY = "y\n";
const YES_STREAM = "y\n".repeat(500);

// 根目錄裡的 ai-global 就是 CLI 本體（~/.local/bin 只是 symlink），優先用它免得 PATH 沒設。
async function locateAiGlobal(root) {
  const local = path.join(root, "ai-global");
  try {
    await fs.access(local, fs.constants.X_OK);
    return local;
  } catch {
    return "ai-global";
  }
}
function run(executable, args, { cwd, stdin = "", log }) {
  return new Promise((resolve, reject) => {
    const extra = ["~/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"].map(
      (dir) => dir.replace(/^~/, os.homedir()),
    );
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, PATH: [...extra, process.env.PATH].join(":") },
    });
    const emit = (chunk) =>
      log(chunk.toString().replace(/\x1b\[[0-9;]*m/g, ""));
    child.stdout.on("data", emit);
    child.stderr.on("data", emit);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code }));
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}
// 分類目錄沒有自己的 SKILL.md；新機器上要等 add-skill 裝完才看得到，所以在執行當下才檢查。
async function isSkillDir(root, vpath) {
  try {
    await fs.access(path.join(root, "v-skills", vpath, "SKILL.md"));
    return true;
  } catch {
    return false;
  }
}
// 順序：先裝好所有 repo，再套狀態，最後 relink 讓各工具拿到新投影。
async function runImport(
  plan,
  { root, log, cancelled = () => false, home, overwrite = false },
) {
  const executable = await locateAiGlobal(root);
  const cwd = home || os.homedir();
  const steps = [];
  const answers = overwrite ? YES_STREAM : INSTALL_ONLY;
  const commands = [
    ...plan.repos.map((repo) => [["add-skill", repo], answers]),
    ...plan.disable.map((vpath) => [["disable", vpath], ""]),
    ...plan.enable.map((vpath) => [["enable", vpath], ""]),
    [["relink"], ""],
  ];
  for (const [args, stdin] of commands) {
    if (cancelled()) break;
    if (
      (args[0] === "disable" || args[0] === "enable") &&
      !(await isSkillDir(root, args[1]))
    ) {
      const skipped = "不是單一 skill 目錄（找不到 SKILL.md）";
      log(`\n略過 ai-global ${args.join(" ")}：${skipped}\n`);
      steps.push({ args, code: null, skipped });
      continue;
    }
    log(`\n$ ai-global ${args.join(" ")}\n`);
    const { code } = await run(executable, args, { cwd, stdin, log });
    steps.push({ args, code });
  }
  return steps;
}
module.exports = { locateAiGlobal, run, runImport };
