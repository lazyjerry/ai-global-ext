/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let entries = [],
  selected = "",
  requestId = 0,
  loading = false;
const previous = vscode.getState() || {};
for (const id of ["mode", "scope", "query"])
  if (typeof previous[id] === "string") $(id).value = previous[id];
function send(type, data = {}) {
  vscode.postMessage({ type, ...data });
}
function save() {
  vscode.setState(
    Object.fromEntries(
      ["category", "status", "mode", "scope", "query"].map((id) => [
        id,
        $(id).value,
      ]),
    ),
  );
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(text, action, className) {
  const element = node("button", text, className);
  element.type = "button";
  element.addEventListener("click", action);
  return element;
}
// 純量陣列（tools、allowed-tools 等）用頓號串起來比 JSON 好讀；巢狀物件才退回 JSON。
function formatValue(value) {
  if (Array.isArray(value) && value.every((item) => typeof item !== "object"))
    return value.join("、");
  if (value !== null && typeof value === "object")
    return JSON.stringify(value, null, 2);
  return String(value);
}
function warnings(items) {
  $("warnings").hidden = !items.length;
  $("warningText").textContent = items.join("\n");
}
function choose(entry) {
  selected = entry.id;
  send("detail", { id: entry.id });
  for (const row of document.querySelectorAll(".card"))
    row.setAttribute("aria-pressed", String(row.dataset.id === selected));
}
// 只有 Skills 有啟用／停用／未投影；其他分類把狀態欄收斂成「全部狀態」並停用，避免選了篩不到東西。
function syncStatus(current = $("status").value) {
  const skills = $("category").value === "Skills";
  $("status").replaceChildren(new Option("全部狀態", ""));
  if (skills)
    for (const name of ["啟用", "停用", "未投影"])
      $("status").add(new Option(name, name));
  $("status").disabled = !skills;
  $("status").value = skills ? current : "";
  if ($("status").selectedIndex < 0) $("status").value = "";
}
function showList() {
  $("list").replaceChildren();
  const filtered = entries.filter(
    (entry) =>
      (!$("category").value || entry.category === $("category").value) &&
      (!$("status").value || entry.status === $("status").value),
  );
  $("message").textContent = `${filtered.length} 個項目`;
  for (const entry of filtered) {
    const card = button("", () => choose(entry), "card");
    card.dataset.id = entry.id;
    card.setAttribute("aria-pressed", String(selected === entry.id));
    card.append(
      node("strong", entry.name),
      node("span", `${entry.category} · ${entry.status}`, "badge"),
      node("p", entry.description || "無摘要"),
      node("small", entry.source, "muted"),
    );
    $("list").append(card);
  }
  if (!filtered.length)
    $("list").append(node("p", "此範圍沒有項目。", "muted"));
}
function runSearch() {
  if (loading) return;
  save();
  requestId++;
  if (!$("query").value.trim()) {
    send("search", { query: "", mode: "name", requestId });
    showList();
    return;
  }
  if ($("scope").value === "selected" && !selected) {
    $("message").textContent = "請先從清單選擇項目，再搜尋所選項目。";
    return;
  }
  $("message").textContent = "搜尋中…";
  send("search", {
    query: $("query").value,
    category: $("category").value,
    status: $("status").value,
    mode: $("mode").value,
    entryId: $("scope").value === "selected" ? selected : "",
    requestId,
  });
}
$("searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});
for (const id of ["category", "status", "mode", "scope"])
  $(id).addEventListener("change", () => {
    if (id === "category") syncStatus();
    runSearch();
  });
$("clear").addEventListener("click", () => {
  $("query").value = "";
  runSearch();
});
for (const id of ["refresh", "settings", "openRoot", "openReadme"])
  $(id).addEventListener("click", () => {
    $("menu").open = false;
    send(id);
  });
document.addEventListener("click", (event) => {
  if (!$("menu").contains(event.target)) $("menu").open = false;
});
$("missingSettings").addEventListener("click", () => send("settings"));
$("readme").addEventListener("click", (event) => {
  event.preventDefault();
  send("openReadme");
});
window.addEventListener("message", ({ data }) => {
  if (data.type === "loading") {
    loading = true;
    $("missing").hidden = true;
    entries = [];
    selected = "";
    requestId++;
    $("list").replaceChildren();
    $("detail").replaceChildren();
    warnings([]);
    $("message").textContent = "讀取資源中…";
  }
  if (data.type === "catalog") {
    loading = false;
    entries = data.entries;
    $("root").textContent = data.root;
    $("root").title = data.rootPath;
    const category = $("category").value || previous.category;
    $("category").replaceChildren(new Option("全部分類", ""));
    for (const name of data.categories)
      $("category").add(
        new Option(
          `${name} (${entries.filter((entry) => entry.category === name).length})`,
          name,
        ),
      );
    if (data.categories.includes(category)) $("category").value = category;
    // 狀態選項要等分類還原後才建得出來，所以在這裡而非啟動時還原上次的狀態。
    syncStatus(previous.status);
    previous.status = "";
    warnings(data.warnings);
    showList();
    if ($("query").value.trim() && $("scope").value !== "selected") runSearch();
  }
  if (data.type === "detail" && data.entry.id === selected) {
    const entry = data.entry,
      detail = $("detail");
    detail.replaceChildren();
    detail.append(
      node("h2", entry.name),
      button("在編輯器開啟原始檔", () => send("open", { file: entry.file })),
      node("p", entry.description),
    );
    const table = node("table", undefined, "meta"),
      body = node("tbody");
    for (const [key, value] of Object.entries({
      分類: entry.category,
      狀態: entry.status,
      來源: entry.source,
      路徑: entry.file,
      修改時間: new Date(entry.modified).toLocaleString(),
      大小: `${entry.size} bytes`,
      ...entry.meta,
    })) {
      const row = node("tr");
      row.append(node("th", key), node("td", formatValue(value)));
      body.append(row);
    }
    table.append(body);
    detail.append(table);
    if (entry.warning) detail.append(node("p", entry.warning));
    if (data.warnings.length)
      detail.append(node("pre", data.warnings.join("\n")));
    const files = node("details");
    files.append(node("summary", `檔案 (${data.files.length})`));
    for (const file of data.files)
      files.append(
        button(file.label, () => send("open", { file: file.file }), "file"),
      );
    detail.append(files);
  }
  if (
    data.type === "results" &&
    data.requestId === requestId &&
    $("query").value.trim()
  ) {
    $("list").replaceChildren();
    warnings(data.warnings);
    $("message").textContent =
      `${data.results.length} 筆結果${data.truncated ? "（已達 300 筆上限，請縮小範圍）" : ""}`;
    for (const hit of data.results) {
      const row = node("article", undefined, "result");
      row.append(
        button(
          `${hit.name} / ${hit.relative}${hit.line ? `:${hit.line}` : ""}`,
          () => send("open", { file: hit.file, line: hit.line }),
          "hit",
        ),
        node("p", hit.snippet),
      );
      const entry = entries.find((item) => item.id === hit.entryId);
      if (entry) row.append(button("查閱項目", () => choose(entry)));
      $("list").append(row);
    }
    if (!data.results.length)
      $("list").append(node("p", "找不到符合的檔案或內文。", "muted"));
  }
  if (data.type === "error") {
    loading = false;
    $("message").textContent = data.message;
  }
  if (data.type === "missing") {
    loading = false;
    $("root").textContent = data.root;
    $("root").title = data.rootPath;
    $("missingText").textContent =
      `${data.root} 不存在，或不是 ai-global 的根目錄。`;
    $("missing").hidden = false;
    $("message").textContent = "尚未偵測到 ai-global，請先安裝或指定資料夾。";
  }
});
send("ready");
