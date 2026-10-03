// The whole demo, end to end, against a running app (`next start`), with the installed Google Chrome.
// Usage: APP=http://localhost:3000 OUT=/tmp/e2e-shots node scripts/e2e.mjs
//
// Gate → Home → Add orders with the sample POs → process → fill the flagged cells → Copy →
// Download Excel → Confirm → the orders on Home and Orders → open one (lines, Source card,
// timeline, customer page, History) → Suggest reply → comment → Mark delivered → as Finance
// (PIN) mark it invoiced → as the owner (PIN) turn on WhatsApp paste → Try an example → Read
// order → the WA-<Customer ID>-<ddmm> rows → a suggested question to the assistant → ⌘K to a
// customer. Then the alias round trip: a SKU picked on Add orders is proposed, the owner approves
// it in Settings, and the next run maps that line by itself. Fails on any console error,
// page error or hydration warning.
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { chromium } from "playwright-core";

const APP = process.env.APP || "http://localhost:3000";
const OUT = process.env.OUT || "/tmp/po-tracker-e2e";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (cond, what) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) failures++;
};
const problems = [];

const browser = await chromium.launch({ channel: "chrome" });

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || (m.type() === "warning" && /hydrat/i.test(m.text()))) problems.push(`${m.type()}: ${m.text()} (${page.url()})`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message} (${page.url()})`));
  return { ctx, page };
}

const idle = (page) => page.waitForFunction(() => ![...document.querySelectorAll(".q .st")].some((e) => /Checking|Reading/.test(e.textContent || "")), null, { timeout: 30000 });
const toast = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector(".toast.on")?.textContent || ""), re.source, { timeout: 10000 });
const text = (page, sel = "main") => page.locator(sel).first().innerText();
const navCount = async (page, href) => Number((await page.locator(`#nav a[href="${href}"] .cnt`).textContent({ timeout: 500 }).catch(() => "0")) || 0);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

/** Switch person through the profile menu, with the PIN for Owner and Finance. */
async function switchTo(page, name, pin) {
  await page.click(".mebtn");
  await page.click(`.pop.up button:has-text("${name}")`);
  if (pin) {
    await page.waitForSelector(".whobox input[name=pin]");
    await page.fill(".whobox input[name=pin]", pin);
    await page.click(".whobox .btn.p");
  }
  await page.waitForURL(/\/home$/);
  await page.waitForSelector(".mebtn");
  ok((await page.locator(".mebtn").innerText()).includes(name), `now working as ${name}`);
}

/* ------------------------------------------------------------------ the walk ---- */
{
  const { ctx, page } = await fresh();

  // Gate.
  await page.goto(`${APP}/home`);
  await page.waitForURL(/\/who/);
  await page.waitForSelector(".whogrid button");
  ok((await text(page, ".whobox")).includes("Who's working?"), "an unpicked session lands on Who's working?");
  await shot(page, "01-gate");
  await page.click('.whogrid button:has-text("Eunice")');
  await page.waitForURL(/\/home$/);
  await page.waitForSelector(".hd h1");
  ok((await text(page)).includes("Hi Eunice"), "Home greets the coordinator");
  const ordersBefore = await navCount(page, "/orders");
  const modSum = () => page.$$eval(".mods .mod .v", (vs) => vs.reduce((a, v) => a + Number(v.textContent), 0));
  const modsBefore = await modSum();
  await shot(page, "02-home");

  // Add orders with the sample POs.
  await page.click('#nav a[href="/add"]');
  await page.waitForSelector("text=Add purchase order PDFs");
  await page.click("text=use the four sample POs");
  await page.waitForSelector(".q li");
  await idle(page);
  const queued = await page.locator(".q li").count();
  ok(queued >= 4, `sample POs queued (${queued} files)`);
  await page.click("button:has-text('Process')");
  await page.waitForFunction(() => [...document.querySelectorAll(".q .st")].every((e) => !/Queued|Reading|Checking/.test(e.textContent || "")), null, { timeout: 30000 });
  const statuses = [];
  for (const li of await page.locator(".q li").all()) statuses.push(`${await li.locator(".fn").innerText()}: ${await li.locator(".st").innerText()} · ${await li.locator(".fs").innerText()}`);
  statuses.forEach((x) => console.log("     " + x));
  ok(statuses.filter((x) => /: (Ready|Needs review) ·/.test(x)).length >= 4, "the four sample POs are read");
  ok(statuses.some((x) => /slides.*Unsupported/.test(x)), "the slide deck is refused as Unsupported");
  await page.waitForSelector(".grid14 tbody td:not(.emptyc)");
  await shot(page, "03-add-processed");

  // Fill the flagged cells.
  let picked = 0;
  while (await page.locator("select[aria-label='Pick SKU']").count()) {
    const sel = page.locator("select[aria-label='Pick SKU']").first();
    await sel.selectOption({ index: 1 });
    await toast(page, /alias proposed/);
    picked++;
  }
  while (await page.locator("select[aria-label='Pick customer']").count()) await page.locator("select[aria-label='Pick customer']").first().selectOption({ index: 1 });
  ok(picked > 0, `flagged SKU cells filled (${picked})`);
  const tb = await text(page, ".toolbar");
  ok(!tb.includes("highlighted cells need a value"), "no cell needs a value");

  // Copy.
  await page.click("button:has-text('Copy table')");
  await toast(page, /Copied \d+ rows/);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip.split("\n").length > 2 && clip.includes("\t"), `Copy table puts tab-separated rows on the clipboard (${clip.split("\n").length} lines)`);

  // Download Excel.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Download Excel')")]);
  const xlsx = `${OUT}/${dl.suggestedFilename()}`;
  await dl.saveAs(xlsx);
  ok(/\.xlsx$/.test(xlsx) && statSync(xlsx).size > 0 && readFileSync(xlsx).subarray(0, 2).toString() === "PK", `Download Excel saves a non-empty .xlsx (${dl.suggestedFilename()}, ${statSync(xlsx).size} bytes)`);

  // Confirm.
  const pos = Number((await page.locator("button:has-text('Confirm')").innerText()).match(/\d+/)[0]);
  await page.click("button:has-text('Confirm')");
  await page.waitForURL(/\/orders$/);
  await toast(page, /orders? confirmed/);
  const ordersAfter = await navCount(page, "/orders");
  ok(ordersAfter === ordersBefore + pos, `rail Orders count ${ordersBefore} → ${ordersAfter} after confirming ${pos} POs`);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("pot-demo-v1")));
  const made = state.orders.filter((o) => Number(o.id.slice(1)) > 100);
  ok(made.length >= pos, `confirmed orders in the store (${made.map((o) => o.po).join(", ")})`);
  const ordersText = await text(page);
  ok(made.every((o) => ordersText.includes(o.po)), "every confirmed order is on Orders");
  await shot(page, "04-orders-after-confirm");

  await page.click('#nav a[href="/home"]');
  await page.waitForSelector(".hd h1");
  await page.waitForTimeout(400);
  const homeText = await text(page);
  const names = [...new Set(made.map((o) => state.customers[o.cust].name))];
  ok(names.every((n) => homeText.includes(n)), `confirmed customers on Home (${names.join(", ")})`);
  const modsAfter = await modSum();
  ok(modsAfter > modsBefore, `Home's Today / Tomorrow / Later this week modules count them (${modsBefore} → ${modsAfter})`);

  // Open one: lines, Source card, timeline.
  const pdfOrder = made.find((o) => o.source === "pdf");
  await page.goto(`${APP}/orders/${pdfOrder.id}`);
  await page.waitForSelector(".pane .prof");
  const pane = await text(page, ".pane");
  ok(pane.includes(state.customers[pdfOrder.cust].name), "side pane is the customer dossier");
  ok(pane.includes(pdfOrder.file.name) && pane.includes(pdfOrder.file.hash) && pane.includes(pdfOrder.file.layout), `Source card: ${pdfOrder.file.name} · ${pdfOrder.file.layout} · ${pdfOrder.file.hash}`);
  ok((await page.locator(".body table.tbl tbody tr").count()) === pdfOrder.lines.length, `order page lists its ${pdfOrder.lines.length} lines`);
  ok(made.every((o) => o.lines.every((l) => state.customers[o.cust].outlets.includes(l.outlet))), "confirmed lines use the customers' own outlet names");
  const tl = await text(page, ".card .log");
  ok(/Reader read PO/i.test(tl) && /Eunice confirmed/.test(tl) && /exported to Excel/.test(tl), "timeline: read, confirmed, exported");
  await shot(page, "05-order-page");

  // Suggest reply, comment, Mark delivered.
  await page.click("button:has-text('Suggest reply')");
  const draft = await page.locator(".draft textarea").inputValue();
  ok(draft.includes(`PO ${pdfOrder.po}`) && draft.includes("Eunice, Edible Garden City"), "Suggest reply drafts the acknowledgement");
  await page.click("button:has-text('Comment')");
  await page.fill("#cmtT", "Packed with the Friday run");
  await page.click(".cmt button:has-text('Post')");
  await toast(page, /Posted/);
  ok((await text(page, ".card .log")).includes("Packed with the Friday run"), "comment in the timeline");
  const inv0 = await page.evaluate(() => JSON.parse(localStorage.getItem("pot-demo-v1")).orders.filter((o) => o.state === "delivered" && !o.invoiced).length);
  await page.click(".hd button:has-text('Mark delivered')");
  await toast(page, /Marked delivered/);
  ok(await page.locator(".labels").innerText().then((t) => t.includes("Delivered")), "order shows Delivered");
  await shot(page, "06-order-delivered");

  // Customer page and History.
  await page.goto(`${APP}/customers/${pdfOrder.cust}`);
  await page.waitForSelector(".two");
  ok((await text(page)).includes(pdfOrder.po), "the order is on its customer page");
  await page.goto(`${APP}/history`);
  await page.waitForSelector(".ht");
  const hist = await text(page);
  ok(hist.includes("Commented") && hist.includes(`Confirmed ${pdfOrder.lines.length} lines`) && hist.includes("Marked delivered"), "History has the confirm, the comment and the delivery");

  // As Finance: mark it invoiced.
  await switchTo(page, "Farah", "1234");
  ok((await navCount(page, "/invoices")) === inv0 + 1, `rail Invoices count is ${inv0 + 1}`);
  await page.goto(`${APP}/invoices`);
  await page.waitForSelector(".hd h1");
  ok((await text(page)).includes(pdfOrder.po), "the delivered order is on Invoices · To invoice");
  await page.goto(`${APP}/orders/${pdfOrder.id}`);
  await page.click(".hd button:has-text('Mark invoiced')");
  await toast(page, /Invoiced INV-2610-/);
  ok((await navCount(page, "/invoices")) === inv0, "rail Invoices count drops back");
  await shot(page, "07-order-invoiced");

  // As the owner: WhatsApp paste on, Try an example, Read order.
  await switchTo(page, "May", "1234");
  await page.goto(`${APP}/add`);
  await page.click(".src button:has-text('WhatsApp order')");
  ok((await text(page, "#dropzone")).includes("WhatsApp orders are turned off"), "Add orders' WhatsApp tab is off before Settings turns it on");
  await page.click("a:has-text('Turn on in Settings')");
  await page.waitForURL(/\/settings\/connections$/);
  await page.click("button[aria-label='WhatsApp paste and chat export']");
  await page.click("button:has-text('Try an example')");
  await page.waitForURL(/\/add$/);
  await page.waitForFunction(() => (document.getElementById("paste")?.value || "").includes("Pea tendrils"));
  ok(true, "Try an example opens Add orders on WhatsApp with the example filled");
  await page.click("button:has-text('Read order')");
  await toast(page, /\d+ lines read/);
  const grid = await text(page, ".grid14 tbody");
  const ddmm = await page.locator("#pdate").inputValue().then((d) => d.slice(8, 10) + d.slice(5, 7));
  const cid = await page.locator("#pcust").inputValue();
  ok(grid.includes(`WA-${cid}-${ddmm}`), `WhatsApp rows carry WA-${cid}-${ddmm}`);
  await shot(page, "08-add-whatsapp");

  // The assistant: a suggested question.
  await page.keyboard.press("Meta+i");
  await page.waitForSelector(".agent .qa button");
  const q = await page.locator(".agent .qa button").first().innerText();
  await page.locator(".agent .qa button").first().click();
  await page.waitForSelector(".agent .ans", { timeout: 5000 });
  ok((await text(page, ".agent .ans")).length > 0, `the assistant answers "${q.trim()}"`);
  await shot(page, "09-assistant");
  await page.keyboard.press("Escape");

  // ⌘K to a customer.
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".pal input");
  await page.fill(".pal input", "Pavilion");
  await page.waitForSelector(".pal .pi");
  // Arrow down to the first hit under Customers, then Enter.
  const at = await page.$$eval(".pal .pl > *", (els) => {
    let g = "",
      i = -1;
    for (const el of els) {
      if (el.classList.contains("ph")) g = el.textContent;
      else {
        i++;
        if (g === "Customers") return i;
      }
    }
    return -1;
  });
  ok(at >= 0, "⌘K lists the customer");
  for (let k = 0; k < at; k++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/customers\/C\d+$/);
  ok((await text(page, ".hd")).includes("Pavilion Kitchen"), "⌘K opens the customer page");
  await shot(page, "10-palette-customer");
  await ctx.close();
}

/* ------------------------------------------------------ the alias round trip ---- */
{
  const { ctx, page } = await fresh();
  await page.goto(`${APP}/who?pin=u1`);
  await page.fill(".whobox input[name=pin]", "1234");
  await page.click(".whobox .btn.p");
  await page.waitForURL(/\/home$/);

  const run = async () => {
    await page.goto(`${APP}/add`);
    await page.click("text=use the four sample POs");
    await idle(page);
    await page.click("button:has-text('Process')");
    await page.waitForFunction(() => [...document.querySelectorAll(".q .st")].every((e) => !/Queued|Reading|Checking/.test(e.textContent || "")), null, { timeout: 30000 });
    await page.waitForSelector(".grid14 tbody td:not(.emptyc)");
    return page.locator("select[aria-label='Pick SKU']").count();
  };
  const flagged = await run();
  const note = await page.locator(".grid14 td.flag .note").first().innerText();
  const wording = note.match(/“(.+)”/)?.[1];
  await page.locator("select[aria-label='Pick SKU']").first().selectOption({ index: 1 });
  await toast(page, /alias proposed/);
  await page.click("button:has-text('Start over')");

  await page.goto(`${APP}/settings/aliases`);
  await page.waitForSelector(".setpane");
  ok((await text(page, ".setpane")).includes(wording), `Settings › Aliases lists the proposed “${wording}”`);
  const row = page.locator(".setpane tr", { hasText: wording }).first();
  await row.locator("button:has-text('Approve')").click();
  await toast(page, /Approved/);

  const after = await run();
  const cells = await text(page, ".grid14 tbody");
  ok(after === flagged - 1 && !(await page.locator(".grid14 td.flag .note", { hasText: wording }).count()), `the next run maps “${wording}” by itself (${flagged} → ${after} SKU cells to fill)`);
  ok(cells.length > 0, "rows read again");
  await ctx.close();
}

await browser.close();
for (const p of problems) console.log("     " + p);
ok(problems.length === 0, `no console errors, page errors or hydration warnings (${problems.length})`);
console.log(failures ? `${failures} check(s) failed` : "all checks passed", "· shots in", OUT);
process.exit(failures ? 1 : 0);
