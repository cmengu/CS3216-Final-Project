// End-to-end check of Add orders against a running app, with the installed Google Chrome.
// Usage: APP=http://localhost:3000 OUT=/tmp/add-shots [PROTO=/path/to/prototype.html] node scripts/e2e-add.mjs
// Stages a synthetic PDF from the importer package, processes it in the browser and asserts what
// the importer answers. When the importer's sample POs are served (public/samples/index.json lists
// them) it goes on: process, fill a flagged cell, Copy, Download Excel, Confirm, see it on Home.
// Screenshots of the app (and of the prototype when PROTO is set) in dark and light go to OUT.
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { chromium } from "playwright-core";

const APP = process.env.APP || "http://localhost:3000";
const OUT = process.env.OUT || "/tmp/po-tracker-add-shots";
const PROTO = process.env.PROTO;
const FIXTURE = process.env.FIXTURE || "node_modules/po-importer/fixtures/f1-two-lines.pdf";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (cond, what) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ channel: "chrome" });

async function open(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript((theme) => {
    try {
      localStorage.setItem("pot-theme", theme);
      sessionStorage.setItem("pot-who", "1"); // past the Who's working? gate as the default person (Eunice, coordinator)
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message));
  return { ctx, page };
}

const fileRow = (page, name) => page.locator(".q li", { has: page.locator(".fn", { hasText: name }) });
const settled = (page) => page.waitForFunction(() => ![...document.querySelectorAll(".q .st")].some((e) => /Checking|Reading/.test(e.textContent || "")), null, { timeout: 30000 });

const samples = await fetch(`${APP}/samples/index.json`).then((r) => (r.ok ? r.json() : []), () => []);
console.log(`samples served: ${samples.length}`);

for (const theme of ["dark", "light"]) {
  const { ctx, page } = await open(theme);
  await page.goto(`${APP}/add`);
  await page.waitForSelector("text=Add purchase order PDFs");

  // Step 1: a synthetic PDF and a file that is not a PDF.
  const name = FIXTURE.split("/").pop();
  await page.setInputFiles('input[type=file][accept="application/pdf"]', [
    { name, mimeType: "application/pdf", buffer: readFileSync(FIXTURE) },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a purchase order") },
  ]);
  await settled(page);
  ok((await fileRow(page, name).locator(".st").textContent()) === "Queued", `${name} is Queued`);
  ok((await fileRow(page, "notes.txt").locator(".st").textContent()) === "Failed", "notes.txt is Failed");
  ok((await fileRow(page, "notes.txt").locator(".fs").textContent()).includes("Not a PDF"), "notes.txt says Not a PDF");

  // The same name again is skipped with the prototype's notice.
  await page.setInputFiles('input[type=file][accept="application/pdf"]', [{ name, mimeType: "application/pdf", buffer: readFileSync(FIXTURE) }]);
  await page.waitForSelector("text=1 duplicate file was skipped");
  ok(true, "duplicate name skipped with notice");

  // ⌘V with a PDF on the clipboard, and a PDF dropped on the section.
  const b64 = readFileSync(FIXTURE).toString("base64");
  await page.evaluate((b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "pasted.pdf", { type: "application/pdf" }));
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt }));
  }, b64);
  const drop = await page.evaluateHandle((b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "dropped.pdf", { type: "application/pdf" }));
    return dt;
  }, b64);
  await page.dispatchEvent("#dropzone", "drop", { dataTransfer: drop });
  await settled(page);
  ok((await fileRow(page, "pasted.pdf").locator(".st").textContent()) === "Queued", "pasted PDF is Queued");
  ok((await fileRow(page, "dropped.pdf").locator(".st").textContent()) === "Queued", "dropped PDF is Queued");

  // Step 2: read them in the browser.
  await page.click("text=Process 3 files");
  await settled(page);
  for (const n of ["pasted.pdf", "dropped.pdf"]) {
    const s2 = await fileRow(page, n).locator(".st").textContent();
    ok(["Unsupported", "Duplicate"].includes(s2), `${n} read (${s2})`);
  }
  const st = await fileRow(page, name).locator(".st").textContent();
  const detail = await fileRow(page, name).locator(".fs").textContent();
  console.log(`     ${name}: ${st} · ${detail}`);
  if (st === "Unsupported") ok(detail.includes("This PO layout is not one of the supported customer layouts."), "Unsupported shows the importer's detail verbatim");
  else ok(["Ready", "Needs review"].includes(st), `${name} read (${st})`);
  ok((await page.textContent(".toolbar")).includes(st === "Unsupported" ? "No rows yet" : "rows from"), "Step 3 row line");
  await page.screenshot({ path: `${OUT}/add-fixture-${theme}-app.png` });

  if (samples.length) {
    const ordersCount = async () => Number((await page.locator('#nav a[href="/orders"] .cnt').textContent().catch(() => "0")) || 0);
    await page.click("text=Start over");
    const before = await ordersCount();
    await page.click("text=use the four sample POs");
    await page.waitForFunction((n) => document.querySelectorAll(".q li").length === n, samples.length);
    await settled(page);
    const names = await page.locator(".q li .fn").allTextContents();
    ok(JSON.stringify(names) === JSON.stringify(samples.map((x) => x.name)), `the four sample files queued in the prototype's order (${names.join(", ")})`);
    await page.click("button:has-text('Process')");
    await settled(page);
    const files = async () => {
      const out = [];
      for (const li of await page.locator(".q li").all()) out.push([await li.locator(".st").textContent(), (await li.locator(".fs").textContent()).replace(/^\d+ KB · /, "")]);
      return out;
    };
    const want = [
      ["Ready", "Buynow · 3 rows"],
      ["Needs review", "Buynow · 2 rows, 1 cell to fill"],
      ["Duplicate", "Same content as HH-2231, confirmed 09:40 · skipped"],
      ["Unsupported", "This PO layout is not one of the supported customer layouts."],
    ];
    const got = await files();
    ok(JSON.stringify(got) === JSON.stringify(want), `files read as the prototype shows them (${got.map((x) => x.join(": ")).join(" | ")})`);
    const bar = async () => (await page.textContent(".toolbar")).replace(/\s+/g, " ");
    ok((await bar()).includes("5 rows from 2 POs · highlighted cells need a value"), "Step 3: 5 rows from 2 POs · highlighted cells need a value");
    ok(await page.locator("button:has-text('Confirm 2 orders')").isVisible(), "Confirm 2 orders");
    ok(await page.locator("button:has-text('Retry 1 failed file')").isVisible(), "Retry 1 failed file");
    ok((await ordersCount()) === before + 2, `the two drafts count in the rail, as the prototype counts them (${before} -> ${await ordersCount()})`);
    await page.screenshot({ path: `${OUT}/add-${theme}-app.png` });

    if (theme === "dark") {
      // Reload: the queue's entries, the Step 3 rows and the draft orders are still there.
      await page.reload();
      await page.waitForSelector(".grid14 tbody td:not(.emptyc)");
      ok(JSON.stringify(await files()) === JSON.stringify(want), "after a reload the Step 2 list is the same");
      ok((await bar()).includes("5 rows from 2 POs"), "after a reload the Step 3 rows are the same");

      // Orders: the Draft tab, as the prototype shows it when there are drafts.
      await page.click('#nav a[href="/orders"]');
      await page.waitForSelector(".tabs");
      const tabs = (await page.textContent(".tabs")).replace(/\s+/g, " ");
      ok(/Draft ?2/.test(tabs), `Orders has the Draft tab with 2 (${tabs.trim().slice(0, 60)})`);
      await page.click('.tabs a:has-text("Draft")');
      await page.waitForFunction(() => document.querySelectorAll(".orow").length === 2);
      const listed = await page.locator(".orow .sub b").allTextContents();
      ok(JSON.stringify(listed.sort()) === JSON.stringify(["HH-2240", "PK-331"]), `Draft tab lists HH-2240 and PK-331 (${listed.join(", ")})`);

      // Open the HH-2240 draft and confirm it there.
      await page.click('.orow:has-text("HH-2240")');
      await page.waitForURL(/\/orders\/o\d+/);
      const draftUrl = page.url();
      ok((await page.textContent(".summary")).includes("Read, not yet confirmed."), "the draft's order page: Read, not yet confirmed.");
      await page.click(".hd button:has-text('Confirm')");
      await page.waitForSelector(".labels .lbl:has-text('Confirmed')");
      ok(true, "Confirm on the order page confirms the draft");
      await page.goto(`${APP}/add`);
      ok((await bar()).includes("2 rows from 1 PO"), "the confirmed order has left the Add orders table");

      // Unconfirm: its rows are back in the Add orders table.
      await page.goto(draftUrl);
      await page.click(".hd button[title='Unconfirm']");
      await page.waitForSelector(".labels .lbl:has-text('Draft')");
      await page.goto(`${APP}/add`);
      ok((await bar()).includes("5 rows from 2 POs"), "after Unconfirm its rows are back in the table");

      // Start over removes the drafts that came from Add orders.
      await page.click("text=Start over");
      ok((await bar()).includes("No rows yet"), "Start over empties the table");
      await page.goto(`${APP}/orders`);
      await page.waitForSelector(".tabs");
      ok(!/Draft/.test(await page.textContent(".tabs")), "Start over removes the drafts: no Draft tab");
      ok((await ordersCount()) === before, "the rail's Orders count is back");

      // The whole walk again: fill the flagged SKU cell, Copy, Download Excel and Confirm.
      await page.goto(`${APP}/add`);
      await page.click("text=use the four sample POs");
      await settled(page);
      await page.click("button:has-text('Process')");
      await settled(page);
      await page.waitForSelector(".grid14 tbody tr td:not(.emptyc)", { timeout: 10000 });
      // Retry checks the Unsupported file again and queues it, as the prototype's retryFailed.
      await page.click("button:has-text('Retry 1 failed file')");
      await settled(page);
      ok((await fileRow(page, "slides_week_06.pdf").locator(".st").textContent()) === "Queued" && (await page.locator("button:has-text('Process 1 file')").isVisible()), "Retry queues the Unsupported file again (Process 1 file)");
      await page.click("button:has-text('Process 1 file')");
      await settled(page);
      ok((await fileRow(page, "slides_week_06.pdf").locator(".st").textContent()) === "Unsupported", "processed again, it is Unsupported again");
      while (await page.locator("select[aria-label='Pick SKU']").count()) {
        const sel = page.locator("select[aria-label='Pick SKU']").first();
        const val = await sel.locator("option").nth(1).getAttribute("value");
        await sel.selectOption(val);
        await page.waitForSelector("text=alias proposed");
      }
      ok(true, "flagged SKU cell filled");
      const pk = page.locator(".grid14 tbody tr", { hasText: "PK-331" }).last();
      ok((await pk.locator("td").nth(3).innerText()).includes("tray"), "the picked line keeps the PO's unit (tray), as the prototype's pick");
      // A typed quantity is saved without redrawing: the row's Total follows on the next redraw.
      const first = page.locator(".grid14 tbody tr").first();
      const total0 = await first.locator("td").nth(5).innerText();
      await first.locator("input[aria-label='Quantity']").fill("5");
      await first.locator("input[aria-label='Quantity']").press("Tab");
      await page.waitForTimeout(200);
      ok((await first.locator("td").nth(5).innerText()) === total0, `a typed quantity leaves the Total as drawn (${total0}) until the next redraw`);
      await page.click("button:has-text('Customise layout')");
      await page.click(".popc label:has-text('Sales Notes') input");
      ok(await page.locator(".popc").isVisible(), "a column toggle keeps Customise layout open");
      await page.click(".popc button:has-text('Reset')");
      await page.waitForTimeout(200);
      ok(!(await page.locator(".popc").count()), "Reset closes Customise layout, as the prototype's redraw does");
      ok((await page.locator(".grid14 tbody tr").first().locator("td").nth(5).innerText()) === "$27.00", "after the redraw the Total follows the typed 5 ($27.00)");
      const copy = page.locator("button:has-text('Copy table')");
      ok(await copy.isEnabled(), "Copy table enabled once no cell needs a value");
      await copy.click();
      await page.waitForSelector("text=Copied 5 rows");
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      ok(clip.split("\n").length === 6 && clip.split("\n")[1].startsWith("HH-2240\t"), "clipboard: header and 5 rows, Sheet first");
      const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Download Excel')")]);
      const path = `${OUT}/${dl.suggestedFilename()}`;
      await dl.saveAs(path);
      const head = readFileSync(path).subarray(0, 2).toString();
      ok(statSync(path).size > 0 && head === "PK", `Excel saved (${dl.suggestedFilename()}, ${statSync(path).size} bytes)`);
      await page.click("button:has-text('Confirm 2 orders')");
      await page.waitForURL(/\/orders/);
      await page.waitForSelector("text=2 orders confirmed");
      ok(true, "Confirm goes to Orders with the prototype's toast");
      await page.goto(`${APP}/home`);
      await page.waitForTimeout(6500);
      ok((await ordersCount()) === before + 2, `Orders count ${before} -> ${await ordersCount()}`);
      const home = await page.textContent("main, body");
      ok(home.includes("Harbour Hotel") && home.includes("Pavilion Kitchen"), "confirmed customers on Home");
      await page.screenshot({ path: `${OUT}/home-after-confirm-${theme}-app.png` });

      // The same PO again, under another name, after it was confirmed.
      await page.goto(`${APP}/add`);
      const bytes = Buffer.from(await (await fetch(`${APP}/samples/${samples[0].name}`)).arrayBuffer());
      await page.setInputFiles('input[type=file][accept="application/pdf"]', [{ name: "again.pdf", mimeType: "application/pdf", buffer: bytes }]);
      await settled(page);
      await page.click("text=Process 1 file");
      await settled(page);
      const d = await fileRow(page, "again.pdf").locator(".fs").textContent();
      ok((await fileRow(page, "again.pdf").locator(".st").textContent()) === "Duplicate" && /Same content as HH-2240, confirmed \d\d:\d\d · skipped/.test(d), `confirmed PO comes back Duplicate (${d})`);
      ok((await bar()).includes("No rows yet"), "a duplicate adds no rows");
      await page.click("text=Start over");

      // WhatsApp: turn the paste connection on in the demo store, read the example, see its rows.
      await page.click(".src button:has-text('WhatsApp order')");
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("pot-demo-v2"));
        s.cx.paste = true;
        localStorage.setItem("pot-demo-v2", JSON.stringify(s));
      });
      await page.reload();
      await page.click("button:has-text('Example')");
      await page.click("button:has-text('Read order')");
      await page.waitForSelector("text=3 lines read, 2 kept as notes");
      ok((await bar()).includes("3 rows from 1 PO") && !(await bar()).includes("highlighted"), "every example line maps to a product, as in the prototype");
      ok(!(await page.locator("select[aria-label='Pick SKU']").count()), "no SKU left to pick");
      ok((await page.textContent(".grid14 tbody")).includes("Hi, order for Mon pls"), "unparsed lines reach Sales Notes");
      ok((await page.inputValue("#paste")) === "", "the paste box is empty again after Read order, as the prototype's redraw leaves it");
      await page.click("button:has-text('Read order')");
      await page.waitForSelector("text=No order lines found");
      ok(true, "Read order on an empty box: No order lines found");
      await page.screenshot({ path: `${OUT}/add-whatsapp-${theme}-app.png` });
    }
  }
  await ctx.close();

  if (PROTO) {
    const { ctx: pctx, page: p } = await open(theme);
    await p.goto(`file://${PROTO}#add`);
    await p.waitForTimeout(800);
    await p.click("text=use the four sample POs");
    await p.waitForTimeout(700);
    await p.click("button:has-text('Process')");
    await p.waitForTimeout(3500);
    await p.screenshot({ path: `${OUT}/add-${theme}-proto.png` });
    await pctx.close();
  }
}

await browser.close();
console.log(failures ? `${failures} check(s) failed` : "all checks passed", "· shots in", OUT);
process.exit(failures ? 1 : 0);
