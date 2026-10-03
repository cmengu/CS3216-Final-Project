// The role test through the running app (`next start`), with the installed Google Chrome.
// Usage: APP=http://localhost:3000 [OUT=/tmp/roles] node scripts/e2e-roles.mjs
//
// For each of the five seeded people: pass the gate (Owner and Finance first get wrong-format
// PINs refused), visit every route, every order and every customer, and use every export path
// (Copy lines on the list and the order page, Copy CSV, Copy table, the assistant's answers, the
// palette). Asserts, on the rendered text, titles, form values and the clipboard:
//  - roles that cannot see prices never receive a price, a money amount or a "$";
//  - account managers only ever see their own customers' orders and customers;
//  - non-owners cannot open People or Settings; only Owner and Finance open Invoices. A page a
//    role may not open draws Home, as the prototype's router does; another customer's order or
//    customer page says Not found, as the prototype's order and customer views do.
// The pure part of the same rules is in src/platform/roles.test.ts.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const APP = process.env.APP || "http://localhost:3000";
const OUT = process.env.OUT || "/tmp/po-tracker-roles";
mkdirSync(OUT, { recursive: true });

let failures = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const MONEY = /\$|\b\d+\.\d{2}\b/;
const PANES = ["lists", "aliases", "connections", "retention", "replies", "assistant"];
const QUESTIONS = ["What is the total for Marina Grand?", "How much do we bill Pavilion Kitchen?", "What did Riverside Club order?", "Catch me up on Orchard Deli"];

const browser = await chromium.launch({ channel: "chrome" });
const problems = [];

/** Everything a person can read on the page: text, titles, labels, field values. */
const everything = (page) =>
  page.evaluate(() => {
    const root = document.getElementById("app") || document.body;
    const attrs = [...root.querySelectorAll("[title],[aria-label],[placeholder]")].map((e) => [e.getAttribute("title"), e.getAttribute("aria-label"), e.getAttribute("placeholder")].filter(Boolean).join(" "));
    const vals = [...root.querySelectorAll("input,textarea,select")].map((e) => e.value);
    const opts = [...root.querySelectorAll("option")].map((o) => o.textContent);
    const pal = document.querySelector(".pal-bg.open")?.innerText || "";
    const toast = document.querySelector(".toast")?.textContent || "";
    return [root.innerText, ...attrs, ...vals, ...opts, pal, toast].join("\n");
  });
const h1 = (page) => page.locator(".hd h1").first().innerText();
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const clearClip = (page) => page.evaluate(() => navigator.clipboard.writeText(""));
const settle = (page, ms = 250) => page.waitForTimeout(ms);

for (const who of [
  { id: "u1", name: "May", role: "owner", pin: true },
  { id: "u2", name: "Eunice", role: "coordinator" },
  { id: "u3", name: "Dennis", role: "account_manager" },
  { id: "u4", name: "Mei", role: "packing" },
  { id: "u5", name: "Farah", role: "finance", pin: true },
]) {
  const priced = ["owner", "coordinator", "finance"].includes(who.role);
  const owner = who.role === "owner";
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`${who.name}: ${m.text()} (${page.url()})`));
  page.on("pageerror", (e) => problems.push(`${who.name}: ${e.message} (${page.url()})`));
  const tag = `${who.name} (${who.role})`;

  // The gate.
  await page.goto(`${APP}/who`);
  await page.click(`.whogrid button:has-text("${who.name}")`);
  if (who.pin) {
    await page.waitForSelector(".whobox input[name=pin]");
    for (const bad of ["12a4", "123", "abcd", "12 4"]) {
      await page.fill(".whobox input[name=pin]", bad);
      await page.click(".whobox .btn.p");
      await settle(page, 200);
      ok(/\/who/.test(page.url()) && (await page.inputValue(".whobox input[name=pin]")) === "", `${tag}: PIN "${bad}" is refused`);
    }
    await page.fill(".whobox input[name=pin]", "1234");
    await page.click(".whobox .btn.p");
  } else ok(!(await page.locator(".whobox input[name=pin]").count()), `${tag}: no PIN asked`);
  await page.waitForURL(/\/home$/);
  await page.waitForSelector(".hd h1");

  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("pot-demo-v1")));
  const me = state.people.find((p) => p.id === who.id);
  const own = (cust) => me.customers === "all" || me.customers.includes(cust);
  const ref = (o) => o.po || `WA-${o.cust}-${o.date.slice(8, 10)}${o.date.slice(5, 7)}`;
  const others = Object.values(state.customers).filter((c) => !own(c.id));
  const otherOrders = state.orders.filter((o) => !own(o.cust));

  const check = async (where, text) => {
    if (!priced) {
      const m = text.match(MONEY);
      ok(!m, `${tag}: no money on ${where}${m ? ` (found "${text.slice(Math.max(0, m.index - 40), m.index + 20).replace(/\n/g, " ")}")` : ""}`);
    }
    if (others.length) {
      const leak = others.find((c) => text.includes(c.name)) || otherOrders.find((o) => o.po && text.includes(o.po));
      ok(!leak, `${tag}: nothing of other customers on ${where}${leak ? ` (${leak.name || leak.po})` : ""}`);
    }
  };
  /** expect: "open" (the page itself), "home" (a route this role may not open), "missing" (Not found). */
  const visit = async (path, expect) => {
    await page.goto(`${APP}${path}`);
    await page.waitForSelector(".hd h1");
    await settle(page);
    const title = (await h1(page)).split("\n")[0];
    const home = (await page.locator(".body.home").count()) > 0;
    const got = title === "Not found" ? "missing" : home && path !== "/home" ? "home" : "open";
    ok(got === expect, `${tag}: ${path} is ${expect} (got ${got}: ${title})`);
    await check(path, await everything(page));
  };
  const may = (yes) => (yes ? "open" : "home");

  // Every route, every order, every customer, every Settings pane.
  await visit("/home", "open");
  await visit("/orders", "open");
  for (const tab of ["needs_check", "blocked", "confirmed", "delivered"]) await visit(`/orders?state=${tab}`, "open");
  for (const o of state.orders) await visit(`/orders/${o.id}`, own(o.cust) ? "open" : "missing");
  await visit("/orders/o999", "missing");
  await visit("/add", may(["owner", "coordinator"].includes(who.role)));
  await visit("/customers", "open");
  for (const c of Object.keys(state.customers)) await visit(`/customers/${c}`, own(c) ? "open" : "missing");
  await visit("/invoices", may(["owner", "finance"].includes(who.role)));
  await visit("/people", may(owner));
  await visit("/history", "open");
  for (const p of [...PANES, "nonsense"]) await visit(`/settings/${p}`, may(owner));
  await visit("/no-such-page", "home");
  ok(owner === (await page.locator('#nav a[href="/people"], #nav a[href^="/settings"]').count()) > 0, `${tag}: People and Settings in the rail only for the owner`);

  // Copy lines: the Orders bulk bar and the order page.
  await page.goto(`${APP}/orders`);
  await page.waitForSelector("#olist");
  for (const cb of (await page.locator("#olist input.sel").all()).slice(0, 6)) await cb.check({ force: true });
  await clearClip(page);
  await page.click(".bulk button:has-text('Copy lines')");
  await settle(page);
  const bulk = await clip(page);
  ok(bulk.length > 0, `${tag}: bulk Copy lines copies`);
  await check("bulk Copy lines", bulk);
  for (const o of state.orders.filter((x) => own(x.cust)).slice(0, 4)) {
    await page.goto(`${APP}/orders/${o.id}`);
    await page.waitForSelector(".hd .ib[title='Copy lines']");
    await clearClip(page);
    await page.click(".hd .ib[title='Copy lines']");
    await settle(page);
    await check(`Copy lines on ${ref(o)}`, await clip(page));
  }

  // Copy CSV on Invoices (both tabs).
  if (["owner", "finance"].includes(who.role)) {
    await page.goto(`${APP}/invoices`);
    await page.waitForSelector("text=Copy CSV");
    await clearClip(page);
    await page.click("button:has-text('Copy CSV')");
    await settle(page);
    const csv = await clip(page);
    ok(csv.startsWith("Customer,Customer ID,PO,Delivered,Lines,Total,Invoice"), `${tag}: Copy CSV copies the invoice CSV`);
    await check("Copy CSV", csv);
  }

  // Copy table on Add orders.
  if (["owner", "coordinator"].includes(who.role)) {
    await page.goto(`${APP}/add`);
    await page.click("text=use the four sample POs");
    await page.waitForSelector(".q li");
    await page.waitForFunction(() => ![...document.querySelectorAll(".q .st")].some((e) => /Checking/.test(e.textContent || "")));
    await page.click("button:has-text('Process')");
    await page.waitForFunction(() => [...document.querySelectorAll(".q .st")].every((e) => !/Queued|Reading|Checking/.test(e.textContent || "")), null, { timeout: 30000 });
    while (await page.locator("select[aria-label='Pick SKU']").count()) {
      await page.locator("select[aria-label='Pick SKU']").first().selectOption({ index: 1 });
      await settle(page, 100);
    }
    await clearClip(page);
    await page.click("button:has-text('Copy table')");
    await settle(page);
    const t = await clip(page);
    ok(t.split("\n").length > 2, `${tag}: Copy table copies rows`);
    await check("Copy table", t);
    await page.click("button:has-text('Start over')");
  }

  // The assistant: every suggested question and a few about money and other customers.
  await page.goto(`${APP}/orders`);
  await page.waitForSelector("#olist");
  await page.keyboard.press("Meta+i");
  await page.waitForSelector(".agent .qa button");
  const qs = await page.locator(".agent .qa button").allInnerTexts();
  for (const q of [...qs.map((x) => x.trim()), ...QUESTIONS]) {
    const n = await page.locator(".agent .ans").count();
    await page.fill(".agent textarea", q);
    await page.keyboard.press("Enter");
    await page.waitForFunction((n) => document.querySelectorAll(".agent .ans").length > n, n, { timeout: 5000 });
  }
  // What the assistant says back: everything in the column except the person's own questions.
  const agentText = await page.evaluate(() => {
    const c = document.querySelector(".agent").cloneNode(true);
    c.querySelectorAll(".turn > .u, textarea").forEach((e) => e.remove());
    return [...c.querySelectorAll(".steps, .recs, .ans, .worked, .qa, .agent-ctx, .tag")].map((e) => e.textContent).join("\n");
  });
  ok((await page.locator(".agent .ans").count()) >= qs.length + QUESTIONS.length, `${tag}: the assistant answered ${qs.length + QUESTIONS.length} questions`);
  const recs = await page.$$eval(".agent a.rec", (as) => as.map((a) => a.getAttribute("href")));
  ok(recs.every((h) => own(state.orders.find((o) => `/orders/${o.id}` === h)?.cust)), `${tag}: the assistant's sources are all in view (${recs.length})`);
  await check("the assistant", agentText);
  await page.screenshot({ path: `${OUT}/assistant-${who.name}.png` });
  await page.keyboard.press("Escape");

  // The palette.
  for (const q of ["", "a", "Harbour", "Marina", "Riverside", "Orchard", "Pavilion", "Invoices", "People", "Settings", "total", "price"]) {
    await page.keyboard.press("Meta+k");
    await page.waitForSelector(".pal-bg.open .pal input");
    await page.fill(".pal input", q);
    await settle(page, 80);
    const t = await page.locator(".pal").innerText();
    await check(`⌘K "${q}"`, t);
    if (!["owner"].includes(who.role)) ok(!/\n(People|Settings)\n/.test(`\n${t}\n`), `${tag}: ⌘K "${q}" offers no People or Settings`);
    if (!["owner", "finance"].includes(who.role)) ok(!/\nInvoices\n/.test(`\n${t}\n`), `${tag}: ⌘K "${q}" offers no Invoices`);
    await page.keyboard.press("Escape");
  }
  await ctx.close();
  console.log(`${failures ? "…   " : "ok  "} ${tag}: ${checks} checks so far, ${failures} failed`);
}

await browser.close();
for (const p of problems) console.log("     " + p);
ok(problems.length === 0, `no console or page errors (${problems.length})`);
console.log(failures ? `${failures} of ${checks} check(s) failed` : `all ${checks} checks passed`);
process.exit(failures ? 1 : 0);
