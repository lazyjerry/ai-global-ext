const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const YAML = require("yaml");

const CATEGORIES = [
  "Skills",
  "Agents",
  "Commands",
  "Rules",
  "全域指示",
  "設定與其他",
];
const SKIP = new Set([".git", "node_modules", "backups", "out", ".DS_Store"]);
const MAX_BYTES = 1024 * 1024;
const README_URL = "https://github.com/lazyjerry/ai-global#readme";
// ai-global 安裝後根目錄至少會有其中一項；全部缺少視為尚未安裝或路徑設錯。
const INSTALL_MARKERS = [
  "ai-global",
  "source.md",
  "skills",
  "v-skills",
  "agents",
  "commands",
  "rules",
];
function expandHome(value) {
  return value === "~"
    ? os.homedir()
    : value.startsWith("~/")
      ? path.join(os.homedir(), value.slice(2))
      : path.resolve(value);
}
// 顯示用：家目錄縮成 ~，避免面板被 /Users/<帳號>/ 佔掉一行。
function contractHome(value) {
  const home = os.homedir();
  return value === home
    ? "~"
    : value.startsWith(home + path.sep)
      ? "~" + value.slice(home.length)
      : value;
}
async function installed(root) {
  root = expandHome(root);
  try {
    if (!(await fs.stat(root)).isDirectory()) return false;
  } catch {
    return false;
  }
  const found = await Promise.all(
    INSTALL_MARKERS.map((name) =>
      fs.stat(path.join(root, name)).then(
        () => true,
        () => false,
      ),
    ),
  );
  return found.includes(true);
}
async function readText(file) {
  // 限制實際讀取量，避免大型檔案或二進位檔拖慢搜尋。
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error("略過超過 1 MiB 或非一般檔案");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES || buffer.subarray(0, bytesRead).includes(0))
      throw new Error("略過大型或二進位檔案");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
function metadata(text, fallback) {
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let meta = {},
    warning = "";
  if (match) {
    try {
      const parsed = YAML.parse(match[1], { maxAliasCount: 20 });
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        meta = parsed;
    } catch {
      warning = "YAML metadata 無法解析，仍可查閱原文";
    }
  }
  const body = match ? text.slice(match[0].length) : text;
  const scalar = (value) =>
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  return {
    name: scalar(meta.name) || fallback,
    description:
      scalar(meta.description) ||
      body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(
          (line) => line && !line.startsWith("#") && !line.startsWith("---"),
        ) ||
      "",
    meta,
    warning,
  };
}
async function exists(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}
async function children(dir, warnings) {
  try {
    return (await fs.readdir(dir))
      .filter((name) => !SKIP.has(name) && !/\.bak(?:-|$)/.test(name))
      .sort();
  } catch (error) {
    if (error.code !== "ENOENT") warnings.push(`${dir}: ${error.message}`);
    return [];
  }
}
async function walk(dir, visit, warnings, ancestors = new Set()) {
  try {
    const real = await fs.realpath(dir);
    if (ancestors.has(real)) return;
    const next = new Set([...ancestors, real]);
    for (const name of await children(dir, warnings)) {
      const file = path.join(dir, name);
      try {
        const stat = await fs.stat(file);
        if (stat.isDirectory()) {
          if ((await visit(file, true)) !== false)
            await walk(file, visit, warnings, next);
        } else if (stat.isFile()) await visit(file, false);
      } catch (error) {
        warnings.push(`${file}: ${error.message}`);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") warnings.push(`${dir}: ${error.message}`);
  }
}
async function scan(root) {
  root = expandHome(root);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("資料來源必須是資料夾");
  const entries = [],
    warnings = [],
    seen = new Set(),
    projected = new Set();
  let disabled = [],
    sources = [];
  for (const name of ["disable-skills.md", "source.md"]) {
    try {
      const text = await readText(path.join(root, name));
      if (name === "disable-skills.md")
        disabled = text
          .split(/\r?\n/)
          .map((line) => line.split("#")[0].trim())
          .filter(Boolean);
      else
        sources = text
          .split(/\r?\n/)
          .map((line) => line.split("|"))
          .filter((parts) => parts.length === 3);
    } catch (error) {
      if (error.code !== "ENOENT") warnings.push(`${name}: ${error.message}`);
    }
  }
  const sourcePaths = await Promise.all(
    sources.map(async ([url, , file]) => ({
      url,
      file: await fs.realpath(expandHome(file)).catch(() => expandHome(file)),
    })),
  );
  const skillFiles = [];
  for (const folder of ["skills", "v-skills"]) {
    await walk(
      path.join(root, folder),
      async (file, isDir) => {
        if (isDir && (await exists(path.join(file, "SKILL.md")))) {
          const main = path.join(file, "SKILL.md");
          if (folder === "skills") projected.add(await fs.realpath(main));
          skillFiles.push(main);
          return false;
        }
      },
      warnings,
    );
  }
  async function add(file, category, skill = false) {
    try {
      const real = await fs.realpath(file);
      if (seen.has(real)) return;
      seen.add(real);
      const info = await fs.stat(real);
      let text = "",
        readWarning = "";
      try {
        text = await readText(real);
      } catch (error) {
        readWarning = error.message;
      }
      const data = metadata(
        text,
        skill ? path.basename(path.dirname(file)) : path.basename(file),
      );
      const vRoot = await fs
        .realpath(path.join(root, "v-skills"))
        .catch(() => path.join(root, "v-skills"));
      const relativeSkill = path
        .relative(vRoot, path.dirname(real))
        .split(path.sep)
        .join("/");
      const inVSkills =
        relativeSkill !== ".." &&
        !relativeSkill.startsWith("../") &&
        !path.isAbsolute(relativeSkill);
      const isDisabled =
        skill &&
        inVSkills &&
        disabled.some((rule) =>
          rule.endsWith("/")
            ? `${relativeSkill}/`.startsWith(rule)
            : relativeSkill === rule,
        );
      const source = sourcePaths.find(
        (record) =>
          real === record.file || real.startsWith(record.file + path.sep),
      );
      entries.push({
        id: real,
        file: real,
        category,
        ...data,
        warning: [data.warning, readWarning].filter(Boolean).join("；"),
        relative: path.relative(root, file),
        source: source?.url || (inVSkills && skill ? relativeSkill : "本機"),
        status: skill
          ? isDisabled
            ? "停用"
            : projected.has(real)
              ? "啟用"
              : "未投影"
          : "可用",
        modified: info.mtime.toISOString(),
        size: info.size,
        directory: skill ? path.dirname(real) : null,
      });
    } catch (error) {
      warnings.push(`${file}: ${error.message}`);
    }
  }
  // 優先實體來源路徑，投影只補入未收錄的本機／system skills。
  skillFiles.sort(
    (a, b) =>
      Number(b.includes(`${path.sep}v-skills${path.sep}`)) -
      Number(a.includes(`${path.sep}v-skills${path.sep}`)),
  );
  for (const file of skillFiles) await add(file, "Skills", true);
  for (const name of await children(root, warnings)) {
    if (await exists(path.join(root, name)))
      await add(
        path.join(root, name),
        /^AGENTS.*\.md$/.test(name) ? "全域指示" : "設定與其他",
      );
  }
  for (const [folder, category] of [
    ["agents", "Agents"],
    ["commands", "Commands"],
    ["rules", "Rules"],
  ]) {
    await walk(
      path.join(root, folder),
      async (file, isDir) => {
        if (!isDir) await add(file, category);
      },
      warnings,
    );
  }
  return {
    root,
    entries: entries.sort(
      (a, b) =>
        CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
        a.name.localeCompare(b.name),
    ),
    warnings,
  };
}
async function filesFor(entry) {
  if (!entry.directory) return { files: [entry.file], warnings: [] };
  const files = [],
    warnings = [],
    seen = new Set();
  await walk(
    entry.directory,
    async (file, isDir) => {
      if (!isDir) {
        const real = await fs.realpath(file);
        if (!seen.has(real)) {
          seen.add(real);
          files.push(file);
        }
      }
    },
    warnings,
  );
  return { files, warnings };
}
async function search(
  entries,
  { query, category = "", mode = "name", status = "", entryId = "" },
  cancelled = () => false,
) {
  const needle = query.trim().toLocaleLowerCase(),
    results = [],
    warnings = [];
  if (!needle) return { results, warnings, truncated: false };
  for (const entry of entries) {
    if (cancelled()) return { results: [], warnings: [], truncated: false };
    if (
      (category && entry.category !== category) ||
      (status && entry.status !== status) ||
      (entryId && entry.id !== entryId)
    )
      continue;
    const listed = await filesFor(entry);
    warnings.push(...listed.warnings);
    for (const file of listed.files) {
      if (cancelled()) return { results: [], warnings: [], truncated: false };
      const relative = path.relative(
        entry.directory || path.dirname(entry.file),
        file,
      );
      if (mode === "name") {
        if (
          `${relative} ${file === entry.file ? entry.name : ""}`
            .toLocaleLowerCase()
            .includes(needle)
        )
          results.push({
            entryId: entry.id,
            file,
            relative,
            name: entry.name,
            line: 0,
            snippet: entry.description,
          });
      } else {
        try {
          const lines = (await readText(file)).split(/\r?\n/);
          for (let line = 0; line < lines.length; line++) {
            if (lines[line].toLocaleLowerCase().includes(needle)) {
              results.push({
                entryId: entry.id,
                file,
                relative,
                name: entry.name,
                line: line + 1,
                snippet: lines[line].slice(0, 240),
              });
              if (results.length >= 300)
                return { results, warnings, truncated: true };
            }
          }
        } catch (error) {
          warnings.push(`${relative}: ${error.message}`);
        }
      }
      if (results.length >= 300) return { results, warnings, truncated: true };
    }
  }
  return { results, warnings, truncated: false };
}
module.exports = {
  scan,
  search,
  filesFor,
  metadata,
  readText,
  expandHome,
  contractHome,
  installed,
  CATEGORIES,
  README_URL,
};
