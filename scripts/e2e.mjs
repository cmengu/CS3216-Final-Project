// The whole demo, end to end, against a running app (`next start`), with the installed Google Chrome.
// Usage: APP=http://localhost:3000 OUT=/tmp/e2e-shots node scripts/e2e.mjs
//
// Gate → Home → open a confirmed order (lines, Source card, timeline) → Suggest reply →
// comment → Mark delivered → its customer page and History → as Finance (PIN) mark it invoiced
// → Invoices (the checker) and one invoice → as the owner (PIN) turn on WhatsApp paste and chat export → Unconfirm and the retention
// switch → a suggested question to the assistant → ⌘K to a customer. Fails on any console error,
// page error or hydration warning.
import { existsSync, mkdirSync } from "node:fs";
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
    if (m.type() === "error" && /127\.0\.0\.1:8000|localhost:8000/.test(m.text())) return;
    if (m.type() === "error" || (m.type() === "warning" && /hydrat/i.test(m.text()))) problems.push(`${m.type()}: ${m.text()} (${page.url()})`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message} (${page.url()})`));
  return { ctx, page };
}

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
  // Owner and Finance land on Invoices; everyone else on Home.
  await page.waitForURL(/\/(home|invoices)$/);
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
  await shot(page, "02-home");

  // Add orders is gone: the rail has no link to it, and its old address draws Home.
  ok((await page.locator('#nav a[href="/add"]').count()) === 0, "the rail has no Add orders");
  await page.goto(`${APP}/add`);
  await page.waitForSelector(".home .lead");
  ok((await text(page)).includes("Hi Eunice"), "the old Add orders address draws Home");

  // Open a confirmed order from the seed: lines, Source card, timeline.
  const pdfOrder = { id: "o1", po: "HH-2231", cust: "C10243", customer: "Harbour Hotel", file: "PO_HH-2231.pdf", hash: "3fa1c09e", lines: 6 };
  await page.goto(`${APP}/orders/${pdfOrder.id}`);
  await page.waitForSelector(".pane .prof");
  const pane = await text(page, ".pane");
  ok(pane.includes(pdfOrder.customer), "side pane is the customer dossier");
  ok(pane.includes(pdfOrder.file) && pane.includes(pdfOrder.hash), `Source card: ${pdfOrder.file} · ${pdfOrder.hash}`);
  ok((await page.locator(".body table.tbl tbody tr").count()) === pdfOrder.lines, `order page lists its ${pdfOrder.lines} lines`);
  const tl = await text(page, ".card .log");
  ok(/Reader read PO/i.test(tl) && /Eunice confirmed/.test(tl) && /exported to Excel/.test(tl), "timeline: read, confirmed, exported");
  await shot(page, "03-order-page");

  // Suggest reply, comment, Mark delivered.
  await page.click("button:has-text('Suggest reply')");
  const draft = await page.locator(".draft textarea").inputValue();
  ok(draft.includes(`PO ${pdfOrder.po}`) && draft.includes("Eunice, Edible Garden City"), "Suggest reply drafts the acknowledgement");
  await page.click("button:has-text('Comment')");
  await page.fill("#cmtT", "Packed with the Friday run");
  await page.click(".cmt button:has-text('Post')");
  await toast(page, /Posted/);
  ok((await text(page, ".card .log")).includes("Packed with the Friday run"), "comment in the timeline");
  await page.click(".hd button:has-text('Mark delivered')");
  await toast(page, /Marked delivered/);
  ok(await page.locator(".labels").innerText().then((t) => t.includes("Delivered")), "order shows Delivered");
  await shot(page, "04-order-delivered");

  // Customer page and History.
  await page.goto(`${APP}/customers/${pdfOrder.cust}`);
  await page.waitForSelector(".two");
  ok((await text(page)).includes(pdfOrder.po), "the order is on its customer page");
  await page.goto(`${APP}/history`);
  await page.waitForSelector(".ht");
  const hist = await text(page);
  ok(hist.includes("Commented") && hist.includes("Marked delivered"), "History has the comment and the delivery");

  // As Finance: mark it invoiced on its order page.
  await switchTo(page, "Farah", "1234");
  await page.goto(`${APP}/orders/${pdfOrder.id}`);
  await page.click(".hd button:has-text('Mark invoiced')");
  await toast(page, /Invoiced INV-2610-/);
  await shot(page, "05-order-invoiced");

  // Invoices comes from the checking service. With the service down the page says so.
  // With it up, the open pile lists its rows and one of them opens.
  await page.goto(`${APP}/invoices`);
  await page.waitForSelector(".ck-boxes");
  await page.waitForFunction(() => {
    const t = document.querySelector("#main")?.textContent || "";
    return /could not be reached|could not be loaded|Nothing to decide|No invoices yet/.test(t) || document.querySelector(".ck-row");
  });
  const invText = await text(page);
  const serviceDown = /could not be reached|could not be loaded/.test(invText);
  if (serviceDown) {
    ok(true, "Invoices says the checking service could not be reached");
  } else {
    ok(invText.includes("Overcharge found"), "Invoices totals the overcharge found");
    for (const label of ["To decide", "Done"]) {
      await page.click(`button.ck-box:has-text("${label}")`);
      const n = Number((await page.locator("button.ck-box.on .num").textContent()) || 0);
      const rows = await page.locator(".ck-row").count();
      ok(rows === n, `${label} lists its ${n} invoice${n === 1 ? "" : "s"}`);
    }
    await page.click('button.ck-box:has-text("To decide")');
    const look = Number((await page.locator("button.ck-box.on .num").textContent()) || 0);
    ok((await navCount(page, "/invoices")) === look, "rail Invoices count is the invoices still to decide");
    if (look) {
      await page.click(".ck-row");
      await page.waitForSelector(".ck-split, .ck-panel");
      ok((await page.locator(".ck-split, .ck-panel").count()) > 0, "an invoice opens from the list");
    }
  }
  await shot(page, "05b-invoice");

  // Upload one dummy PDF. The file lives with the service; INVOICE_PDF can point at it.
  const invoicePdf = process.env.INVOICE_PDF || "data/dummy/invoice-02.pdf";
  if (existsSync(invoicePdf)) {
    await page.goto(`${APP}/invoices`);
    await page.waitForSelector("input.ck-file", { state: "attached" });
    await page.setInputFiles("input.ck-file", invoicePdf);
    await page.waitForSelector(".ck-status.on");
    if (serviceDown) {
      await toast(page, /could not be reached|not ready|could not be checked/);
      ok(true, "upload says what went wrong, in one sentence");
    } else {
      await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/i, { timeout: 120000 });
      await page.waitForSelector(".ck-card");
      const uploaded = await text(page);
      ok(uploaded.includes("DEMO-002") && uploaded.includes("15.00"), "uploading invoice-02.pdf opens that invoice");
      ok(uploaded.includes("Fixture answers"), "the uploaded invoice is marked as fixture answers");
    }
    await shot(page, "05c-upload");
  }

  // As the owner: WhatsApp paste and chat export turns on in Settings.
  await switchTo(page, "May", "1234");
  await page.goto(`${APP}/settings/connections`);
  await page.click("button[aria-label='WhatsApp paste and chat export']");
  await page.waitForSelector("button:has-text('Try a sample export')");
  ok(!(await page.locator("button:has-text('Try an example')").count()), "Connections offers the chat export, and nothing that leads to Add orders");
  await shot(page, "06-connections");

  // Retention off hides Confirm on the order page (an unconfirmed order is a draft).
  const other = "o3";
  await page.goto(`${APP}/orders/${other}`);
  await page.click(".hd .ib[title='Unconfirm']");
  await toast(page, /Unconfirmed/);
  ok(await page.locator(".hd button:has-text('Confirm')").isVisible(), "an unconfirmed order offers Confirm");
  await page.goto(`${APP}/settings/retention`);
  await page.uncheck("#ret");
  await page.goto(`${APP}/orders/${other}`);
  await page.waitForSelector(".hd h1");
  ok(!(await page.locator(".hd button:has-text('Confirm')").count()), "retention off: no Confirm on the order page");
  await page.goto(`${APP}/settings/retention`);
  await page.check("#ret");

  // The assistant: a suggested question.
  await page.keyboard.press("Meta+i");
  await page.waitForSelector(".agent .qa button");
  const q = await page.locator(".agent .qa button").first().innerText();
  await page.locator(".agent .qa button").first().click();
  await page.waitForSelector(".agent .ans", { timeout: 5000 });
  ok((await text(page, ".agent .ans")).length > 0, `the assistant answers "${q.trim()}"`);
  await shot(page, "07-assistant");
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
  await shot(page, "08-palette-customer");
  await ctx.close();
}

/* --------------------------------------------- what the prototype's redraws do ---- */
// The prototype draws the whole page again after every change. These checks hold the app to what
// that redraw does: greet again after a pick, Esc and Enter on the Orders list, the order page's
// fixed review wording, the pane coming back, events logged without a redraw, the page back at the top.
{
  const { ctx, page } = await fresh();
  await page.goto(`${APP}/who`);
  await page.click('.whogrid button:has-text("Eunice")');
  await page.waitForURL(/\/home$/);
  await page.waitForSelector(".home .lead");
  await page.waitForTimeout(300);
  await page.click(".mebtn");
  await page.click('.pop.up button:has-text("Mei")');
  await page.waitForTimeout(500);
  ok((await page.getAttribute(".home .lead", "class")).includes("greet") && (await text(page, ".home .lead")).includes("Hi Mei"), "picking a person while on Home greets them again");
  await page.click(".mebtn");
  await page.click('.pop.up button:has-text("Eunice")');
  await page.waitForTimeout(400);

  // Orders: Esc with a ticked box focused clears the selection and leaves the assistant open.
  await page.click('#nav a[href="/orders"]');
  await page.waitForSelector("#olist .orow");
  await page.keyboard.press("Meta+i");
  await page.waitForTimeout(200);
  await page.hover('.orow[data-id="o1"]');
  await page.click('.orow[data-id="o1"] .sel');
  ok(await page.locator(".bulk").isVisible(), "a ticked row shows the bulk bar");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok(!(await page.locator(".bulk").count()) && (await page.locator("#app.agent-open").count()) === 1, "Esc clears the selection first and leaves the assistant open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  ok(!(await page.locator("#app.agent-open").count()), "the next Esc closes the assistant");
  // A hover Mark delivered redraws the list, which clears the selection.
  await page.hover('.orow[data-id="o3"]');
  await page.click('.orow[data-id="o3"] .sel');
  await page.hover('.orow[data-id="o1"]');
  await page.click('.orow[data-id="o1"] button[title="Mark delivered"]');
  await toast(page, /Marked delivered/);
  ok(!(await page.locator(".bulk").count()), "Mark delivered from a row clears the selection");
  // Enter opens the current row even with the rail link just clicked still focused.
  await page.click('#nav a[href="/orders"]');
  await page.waitForTimeout(300);
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/orders\/o\d+$/);
  ok(true, "j then Enter opens the first row");

  // The order page: the Needs check wording is the prototype's fixed text, after a second revision too.
  await page.goto(`${APP}/orders/o2`);
  await page.waitForSelector(".summary");
  await page.click('button:has-text("Approve change")');
  await toast(page, /Approved/);
  await switchTo(page, "May", "1234");
  await page.goto(`${APP}/settings/connections`);
  await page.click("button[aria-label='WhatsApp paste and chat export']");
  await page.click("button:has-text('Try a sample export')");
  await toast(page, /1 change to review/);
  await page.goto(`${APP}/orders/o2`);
  await page.waitForSelector(".review");
  ok((await text(page, ".summary")) === "Revised PO received 10:48. Line 1 qty 4 → 6, unconfirmed.", "a later revision keeps the prototype's summary sentence");
  await page.click('#nav a[href="/orders"]');
  await page.waitForSelector('.orow[data-id="o2"]');
  ok((await text(page, '.orow[data-id="o2"] .sub')).includes("qty 4 → 6 on line 1, unconfirmed"), "and the prototype's row line on Orders");

  // The pane's Hide lasts until the next change; "Viewed prices" and "Asked" show from the next change.
  await page.goto(`${APP}/orders/o3`);
  await page.waitForSelector(".pane .prof");
  const log = () => text(page, ".card .log");
  ok(!(await log()).includes("May viewed prices"), "opening an order logs Viewed prices without showing it yet");
  await page.click('.pane button[title="Hide"]');
  ok(!(await page.locator("#main.withpane").count()), "Hide drops the pane's column");
  await page.click('.body button:has-text("Ask")');
  await page.locator(".agent .qa button").first().click();
  await page.waitForSelector(".agent .ans");
  ok(!(await log()).includes("May asked"), "an answer scoped to the order is logged without redrawing the page");
  await page.keyboard.press("Escape");
  await page.click("button:has-text('Suggest reply')");
  await page.waitForSelector(".draft");
  ok((await log()).includes("May viewed prices") && (await log()).includes("May asked"), "the next change shows them");
  ok((await page.locator("#main.withpane").count()) === 1, "and brings the pane back");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("pot-demo-v3")).settings.reply);
  ok(JSON.stringify(stored) === JSON.stringify({ lines: true, date: true, sign: true }), "Suggest reply stores the reply defaults, as the prototype's replyOpt");
  await page.evaluate(() => document.getElementById("main").scrollTo({ top: 400 }));
  await page.click("button:has-text('Discard')");
  await page.waitForTimeout(200);
  ok((await page.evaluate(() => document.getElementById("main").scrollTop)) === 0, "a change puts the page back at the top");

  // Settings › Assistant access: the person picker goes back to the first person after Create key.
  await page.goto(`${APP}/settings/assistant`);
  await page.selectOption("#keyWho", "u4");
  await page.click("button:has-text('Create key')");
  ok((await page.inputValue("#keyWho")) === "u1" && (await text(page, ".setpane")).includes("Mei's key"), "Create key, then the picker is back on May");
  await ctx.close();
}

await browser.close();
for (const p of problems) console.log("     " + p);
ok(problems.length === 0, `no console errors, page errors or hydration warnings (${problems.length})`);
console.log(failures ? `${failures} check(s) failed` : "all checks passed", "· shots in", OUT);
process.exit(failures ? 1 : 0);
