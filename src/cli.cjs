const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

// bash 的 read -p 在 stdin 不是 tty 時不會印出提示，無法看到提示再回答；
// add-skill 只會問「是否安裝」與每個既有 skill 的「是否覆蓋」，兩者都要 y，
// 直接餵固定答案流，超出的提示讀到 EOF 取預設值。
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
// 順序：先裝好所有 repo，再套狀態，最後 relink 讓各工具拿到新投影。
async function runImport(plan, { root, log, cancelled = () => false, home }) {
  const executable = await locateAiGlobal(root);
  const cwd = home || os.homedir();
  const steps = [];
  const commands = [
    ...plan.repos.map((repo) => [["add-skill", repo], YES_STREAM]),
    ...plan.disable.map((vpath) => [["disable", vpath], ""]),
    ...plan.enable.map((vpath) => [["enable", vpath], ""]),
    [["relink"], ""],
  ];
  for (const [args, stdin] of commands) {
    if (cancelled()) break;
    log(`\n$ ai-global ${args.join(" ")}\n`);
    const { code } = await run(executable, args, { cwd, stdin, log });
    steps.push({ args, code });
  }
  return steps;
}
module.exports = { locateAiGlobal, run, runImport };
