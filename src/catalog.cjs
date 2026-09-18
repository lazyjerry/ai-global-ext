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
const SKILLS_FORMAT = "ai-global-explorer/skills";
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
        repo: source?.url || "",
        vpath: inVSkills && skill ? relativeSkill : "",
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
// 匯出只涵蓋 Skills：CLI 只有 add-skill 能依 source.md 重裝，其他分類沒有對應指令。
function exportSkills(catalog) {
  return {
    format: SKILLS_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    root: contractHome(catalog.root),
    skills: catalog.entries
      .filter((entry) => entry.category === "Skills")
      .map((entry) => ({
        name: entry.name,
        path: entry.vpath,
        repo: entry.repo || null,
        status: entry.status,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}
// 前綴與 ai-global CLI 的 not_github_ref／parse_github_ref 相同，再收緊成只收 owner/repo：
// CLI 本來就拒絕子路徑；repo 名為 . 或 .. 會讓安裝路徑跳出 v-skills/<owner>/。
function githubRepo(value) {
  if (typeof value !== "string") return "";
  const match = value
    .replace(/^(?:https?:\/\/)?github\.com\//, "")
    .match(/^([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match || match[2] === "." || match[2] === "..") return "";
  return `${match[1]}/${match[2]}`;
}
// 匯出的 path 是 v-skills 相對路徑 owner/repo[/bucket]/name，一定落在該 skill 自己的 repo 底下。
// 不收裸名稱與 . / ..：CLI 的 disable／enable 會把裸名稱當 skill 名稱比對。
function validVpath(vpath, slug) {
  return (
    typeof vpath === "string" &&
    vpath.startsWith(`${slug}/`) &&
    vpath
      .split("/")
      .every(
        (part) =>
          part &&
          part !== "." &&
          part !== ".." &&
          !/[\\\x00-\x1f\x7f]/.test(part),
      )
  );
}
// add-skill 以 repo 為單位安裝，所以只需去重後的 repo 清單；狀態差異才逐筆 disable／enable。
function importPlan(data, catalog) {
  if (!data || data.format !== SKILLS_FORMAT || !Array.isArray(data.skills))
    throw new Error(`不是 ${SKILLS_FORMAT} 格式的匯出檔`);
  if (data.version !== 1)
    throw new Error(`不支援的匯出檔版本：${data.version}`);
  const localSkills = catalog.entries.filter(
    (entry) => entry.category === "Skills" && entry.vpath,
  );
  const local = new Map(
    localSkills.map((entry) => [entry.vpath, entry.status]),
  );
  // CLI 的 disable／enable 收到分類路徑會作用在整個分類，必須只留單一 skill。
  const known = [
    ...local.keys(),
    ...data.skills
      .map((skill) => skill?.path)
      .filter((p) => typeof p === "string"),
  ];
  const isCategory = (vpath) => known.some((p) => p.startsWith(`${vpath}/`));
  const repos = [],
    slugs = [],
    disable = [],
    enable = [],
    skipped = [];
  for (const skill of data.skills) {
    if (!skill || typeof skill !== "object") continue;
    const { repo, status } = skill;
    const name = String(skill.name ?? "");
    const vpath = typeof skill.path === "string" ? skill.path : "";
    const skip = (reason) => skipped.push({ name, path: vpath, reason });
    if (typeof repo !== "string" || !repo) {
      skip("沒有 GitHub 來源");
      continue;
    }
    const slug = githubRepo(repo);
    if (!slug) {
      skip("repo 不是合法的 GitHub 倉庫");
      continue;
    }
    if (vpath && !validVpath(vpath, slug)) {
      skip("路徑不是該 repo 底下的 skill 路徑");
      continue;
    }
    if (vpath && isCategory(vpath)) {
      skip("路徑是分類而非單一 skill");
      continue;
    }
    if (!repos.includes(repo)) {
      repos.push(repo);
      slugs.push(slug);
    }
    if (!vpath) continue;
    if (status === "停用" && local.get(vpath) !== "停用") disable.push(vpath);
    if (status === "啟用" && local.get(vpath) === "停用") enable.push(vpath);
  }
  // add-skill 裝在 v-skills/<owner>/<repo>/ 底下，本機已有的同 repo skill 就是會被問「是否覆蓋」的對象。
  const overwrite = localSkills
    .map((entry) => entry.vpath)
    .filter((vpath) => slugs.some((slug) => vpath.startsWith(`${slug}/`)))
    .sort();
  return { repos, overwrite, disable, enable, skipped };
}
// 確認視窗的清單過長時只列前幾個，其餘以筆數帶過，避免 modal 超出螢幕。
const LIST_LIMIT = 10;
function listSection(title, items) {
  if (!items.length) return "";
  const shown = items.slice(0, LIST_LIMIT).map((item) => `• ${item}`);
  if (items.length > LIST_LIMIT)
    shown.push(`…另 ${items.length - LIST_LIMIT} 個`);
  return [`${title}（${items.length}）：`, ...shown].join("\n");
}
// 名稱來自匯入檔，換行等控制字元會在確認視窗裡偽造出額外的列。
function displayName(skill) {
  return String(skill.name || skill.path || "（無名稱）")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, 80);
}
function skippedSummary(skipped) {
  if (!skipped.length) return "";
  const shown = skipped
    .slice(0, LIST_LIMIT)
    .map((skill) => `${displayName(skill)}（${skill.reason}）`);
  if (skipped.length > LIST_LIMIT)
    shown.push(`另 ${skipped.length - LIST_LIMIT} 個`);
  return `略過 ${skipped.length} 個：${shown.join("、")}`;
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
  exportSkills,
  importPlan,
  githubRepo,
  validVpath,
  LIST_LIMIT,
  listSection,
  skippedSummary,
  CATEGORIES,
  README_URL,
  SKILLS_FORMAT,
};
