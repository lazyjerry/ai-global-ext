const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { CATEGORIES, README_URL } = require("../src/catalog.cjs");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 360, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.messages = [];
      window.acquireVsCodeApi = () => ({
        getState: () => ({}),
        setState: () => {},
        postMessage: (data) => window.messages.push(data),
      });
    });
    const post = (data) =>
      page.evaluate(
        (data) => window.dispatchEvent(new MessageEvent("message", { data })),
        data,
      );
    const html = (await fs.readFile("media/view.html", "utf8"))
      .replace("{{csp}}", "'self'")
      .replaceAll("{{nonce}}", "ui-test")
      .replaceAll("{{readme}}", README_URL)
      .replace("{{style}}", "/style.css")
      .replace("{{script}}", "/view.js");
    await page.route("http://ai-global.test/**", async (route) => {
      const name = new URL(route.request().url()).pathname;
      await route.fulfill({
        contentType:
          name === "/view.js"
            ? "text/javascript"
            : name === "/style.css"
              ? "text/css"
              : "text/html",
        body:
          name === "/"
            ? html
            : await fs.readFile(path.join("media", name.slice(1))),
      });
    });
    await page.goto("http://ai-global.test/");
    for (const id of ["category", "status", "mode", "scope"])
      assert.ok(
        await page.locator(`label:has(#${id})`).getAttribute("title"),
        `${id} 缺少 tooltip`,
      );
    const groupEdges = (edge) =>
      page.evaluate(
        (edge) =>
          new Set(
            [...document.querySelectorAll("#searchForm > div")].map(
              (group) => group[edge],
            ),
          ).size,
        edge,
      );
    assert.equal(await groupEdges("offsetLeft"), 1, "窄版應為上下三列");
    assert.equal(await groupEdges("offsetTop"), 3, "窄版應為上下三列");
    await post({ type: "missing", root: "/nowhere/.ai-global" });
    assert.equal(await page.locator("#missing").isVisible(), true);
    assert.match(
      await page.locator("#missingText").textContent(),
      /\/nowhere\/\.ai-global/,
    );
    assert.equal(
      await page.locator("#readme").getAttribute("href"),
      README_URL,
    );
    await page.locator("#openReadme").click();
    assert.equal(
      await page.evaluate(() => window.messages.at(-1).type),
      "openReadme",
    );
    await post({ type: "loading" });
    assert.equal(await page.locator("#missing").isVisible(), false);
    const entry = {
      id: "/skills/demo/SKILL.md",
      file: "/skills/demo/SKILL.md",
      name: "<img src=x onerror=alert(1)>",
      description: "Distinctive summary",
      category: "Skills",
      status: "啟用",
      source: "Local",
      modified: new Date().toISOString(),
      size: 20,
      meta: { tools: ["read", "search"] },
    };
    await post({
      type: "catalog",
      root: "/demo",
      entries: [
        entry,
        {
          ...entry,
          id: "/agents/a.md",
          name: "Agent Beta",
          category: "Agents",
        },
      ],
      categories: CATEGORIES,
      warnings: [],
    });
    assert.equal(await page.locator(".card").count(), 2);
    assert.equal(await page.locator("#root").isVisible(), false);
    await page.locator("#menu summary").click();
    assert.equal(await page.locator("#root").textContent(), "/demo");
    await page.locator("#openRoot").click();
    assert.equal(
      await page.evaluate(() => window.messages.at(-1).type),
      "openRoot",
    );
    assert.equal(await page.locator("#root").isVisible(), false, "選單應關閉");
    await page.locator(".card").first().click();
    await post({
      type: "detail",
      entry,
      files: [{ file: entry.file, label: "SKILL.md" }],
      warnings: [],
    });
    assert.equal(await page.locator("#detail img").count(), 0);
    assert.match(await page.locator("#detail h2").textContent(), /<img src=x/);
    assert.equal(await page.locator("#detail pre, .content").count(), 0);
    assert.equal(
      await page
        .locator(".meta tr", { hasText: "tools" })
        .locator("td")
        .textContent(),
      "read、search",
    );
    await page.getByText("在編輯器開啟原始檔").click();
    assert.equal(
      await page.evaluate(() => window.messages.at(-1).type),
      "open",
    );
    assert.equal(await page.locator("#status").isDisabled(), true);
    assert.equal(await page.locator("#status option").count(), 1);
    await page.selectOption("#category", "Skills");
    assert.equal(await page.locator(".card").count(), 1);
    assert.equal(await page.locator("#status").isDisabled(), false);
    assert.deepEqual(await page.locator("#status option").allTextContents(), [
      "全部狀態",
      "啟用",
      "停用",
      "未投影",
    ]);
    await page.selectOption("#status", "停用");
    assert.equal(await page.locator(".card").count(), 0);
    await page.selectOption("#category", "Agents");
    assert.equal(await page.locator("#status").isDisabled(), true);
    assert.equal(await page.inputValue("#status"), "");
    assert.equal(await page.locator(".card").count(), 1);
    await page.selectOption("#category", "Skills");
    await page.selectOption("#mode", "content");
    await page.fill("#query", "needle");
    await page.locator("#query").press("Enter");
    const request = await page.evaluate(() => window.messages.at(-1));
    assert.equal(request.category, "Skills");
    assert.equal(request.mode, "content");
    await post({
      type: "results",
      requestId: request.requestId - 1,
      results: [],
      warnings: [],
    });
    assert.equal(await page.locator("#message").textContent(), "搜尋中…");
    await post({
      type: "results",
      requestId: request.requestId,
      results: [
        {
          entryId: entry.id,
          name: entry.name,
          file: "/skills/demo/ref.md",
          relative: "ref.md",
          line: 7,
          snippet: "needle",
        },
      ],
      warnings: [],
      truncated: false,
    });
    await page.locator(".hit").click();
    assert.equal(await page.evaluate(() => window.messages.at(-1).line), 7);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.setViewportSize({ width: 1000, height: 800 });
    assert.equal(await groupEdges("offsetLeft"), 1, "寬版控制項仍上下堆疊");
    assert.equal(
      await page.evaluate(
        () =>
          new Set(
            [
              document.querySelector("#controls"),
              ...document.querySelectorAll("main > section"),
            ].map((column) => column.offsetLeft),
          ).size,
      ),
      3,
      "寬版應為控制項、清單、內容三欄",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.locator("#clear").click();
    assert.equal(await page.locator(".card").count(), 1);
    assert.deepEqual(errors, []);
    console.log(
      "UI: filtering, metadata table, escaped content, search, stale results, editor messages, install notice, settings menu, status by category, tooltips and responsive layout passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
