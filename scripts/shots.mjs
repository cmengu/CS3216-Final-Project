// Side-by-side screenshots of the approved prototype and the app, in both themes, with a pixel diff.
// Usage: PROTO=/path/to/prototype.html APP=http://localhost:3000 OUT=/tmp/shots [ONLY=home,orders] node scripts/shots.mjs
// Needs Google Chrome installed (playwright-core drives it with channel "chrome").
// Each screen is drawn fresh (new browser context, the seeded demo data) as the person it names;
// with PROTO set it writes <name>-<theme>-proto.png, -app.png and -diff.png (differing pixels in
// red) and prints how many pixels differ.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const PROTO = process.env.PROTO;
const APP = process.env.APP || "http://localhost:3000";
const OUT = process.env.OUT || "/tmp/po-tracker-shots";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
mkdirSync(OUT, { recursive: true });

const SETTLE = { wait: 6500 }; // past Home's greeting
// [name, prototype hash, app path, options]. user: u1 May owner, u2 Eunice coordinator (default),
// u3 Dennis account manager, u4 Mei packing, u5 Farah finance.
const SCREENS = [
  ["gate", "#home", "/who", { gate: true }],
  ["pin", "#home", "/who?pin=u1", { gate: true, pin: true }],
  ["home", "#home", "/home", SETTLE],
  ["home-greet", "#home", "/home", { wait: 1200 }],
  ["menu", "#home", "/home", { ...SETTLE, menu: true }],
  ["owner-home", "#home", "/home", { ...SETTLE, user: "u1" }],
  ["finance-home", "#home", "/home", { ...SETTLE, user: "u5" }],
  ["packing-home", "#home", "/home", { ...SETTLE, user: "u4" }],
  ["am-home", "#home", "/home", { ...SETTLE, user: "u3" }],
  ["mobile-home", "#home", "/home", { ...SETTLE, w: 390, h: 844 }],
  ["agent", "#home", "/home", { ...SETTLE, agent: true }],
  ["palette", "#home", "/home", { ...SETTLE, palette: true }],
  ["orders", "#orders", "/orders", {}],
  ["orders-needs", "#orders/needs_check", "/orders?state=needs_check", {}],
  ["orders-delivered", "#orders/delivered", "/orders?state=delivered", {}],
  ["orders-am", "#orders", "/orders", { user: "u3" }],
  ["order-o2", "#order/o2", "/orders/o2", { twice: true }],
  ["order-o4", "#order/o4", "/orders/o4", { twice: true }],
  ["order-o1-packing", "#order/o1", "/orders/o1", { user: "u4" }],
  ["order-o2-packing", "#order/o2", "/orders/o2", { user: "u4" }],
  ["order-o4-am", "#order/o4", "/orders/o4", { user: "u3" }],
  ["invoices-coordinator", "#invoices", "/invoices", {}],
  ["settings-unknown", "#settings/nonsense", "/settings/nonsense", { user: "u1" }],
  ["order-o3-finance", "#order/o3", "/orders/o3", { user: "u5", twice: true }],
  ["add", "#add", "/add", {}],
  ["add-processed", "#add", "/add", { act: processSamples }],
  ["add-processed-top", "#add", "/add", { act: processSamples, top: true }],
  ["customers", "#customers", "/customers", {}],
  ["customer-C10310", "#customer/C10310", "/customers/C10310", {}],
  ["customer-C10243-finance", "#customer/C10243", "/customers/C10243", { user: "u5" }],
  ["customer-C10310-packing", "#customer/C10310", "/customers/C10310", { user: "u4" }],
  ["invoices", "#invoices", "/invoices", { user: "u5" }],
  ["people", "#people", "/people", { user: "u1" }],
  ["history", "#history", "/history", { user: "u1" }],
  ["history-packing", "#history", "/history", { user: "u4" }],
  ["settings-lists", "#settings/lists", "/settings/lists", { user: "u1" }],
  ["settings-aliases", "#settings/aliases", "/settings/aliases", { user: "u1" }],
  ["settings-connections", "#settings/connections", "/settings/connections", { user: "u1" }],
  ["settings-retention", "#settings/retention", "/settings/retention", { user: "u1" }],
  ["settings-replies", "#settings/replies", "/settings/replies", { user: "u1" }],
  ["settings-assistant", "#settings/assistant", "/settings/assistant", { user: "u1" }],
];

/** Add orders with the sample POs queued and processed (the prototype's are invented, the app's are the importer's). */
async function processSamples(page, proto) {
  // The prototype's Customise layout popover is always open (a CSS slip); closed here to compare the table.
  if (proto) await page.addStyleTag({ content: "#colpop{display:none!important}" });
  await page.click("text=use the four sample POs");
  await page.waitForTimeout(1200);
  await page.click("button:has-text('Process')");
  await page.waitForFunction(() => [...document.querySelectorAll(".q .st")].every((e) => !/Queued|Reading|Checking/.test(e.textContent || "")), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector(".grid14")?.scrollIntoView({ block: "start" }));
}

const NAMES = { u1: "May", u2: "Eunice", u3: "Dennis", u4: "Mei", u5: "Farah" };
const browser = await chromium.launch({ channel: "chrome" });
const differ = await (await browser.newContext()).newPage();

/** Counts differing pixels between two PNGs of the same size and writes a diff image. */
async function diff(a, b, out) {
  const r = await differ.evaluate(
    async ([a, b]) => {
      const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = "data:image/png;base64," + src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { n: -1 };
      const px = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
      const da = px(ia), db = px(ib);
      const c = document.createElement("canvas"); c.width = ia.width; c.height = ia.height; const x = c.getContext("2d");
      x.globalAlpha = 0.25; x.drawImage(ia, 0, 0); x.globalAlpha = 1;
      const o = x.getImageData(0, 0, c.width, c.height);
      let n = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        if (da.data[i] !== db.data[i] || da.data[i + 1] !== db.data[i + 1] || da.data[i + 2] !== db.data[i + 2]) {
          n++;
          o.data[i] = 255; o.data[i + 1] = 0; o.data[i + 2] = 0; o.data[i + 3] = 255;
        }
      }
      x.putImageData(o, 0, 0);
      return { n, png: c.toDataURL("image/png").split(",")[1] };
    },
    [readFileSync(a).toString("base64"), readFileSync(b).toString("base64")],
  );
  if (r.png) writeFileSync(out, Buffer.from(r.png, "base64"));
  return r.n;
}

const results = [];
for (const theme of ["dark", "light"]) {
  for (const [name, hash, path, o] of SCREENS) {
    if (ONLY && !ONLY.includes(name)) continue;
    for (const side of PROTO ? ["proto", "app"] : ["app"]) {
      const ctx = await browser.newContext({ viewport: { width: o.w || 1440, height: o.h || 900 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(
        ([theme, gate]) => {
          try {
            localStorage.setItem("pot-theme", theme);
            if (!gate) sessionStorage.setItem("pot-who", "1");
          } catch {}
        },
        [theme, !!o.gate],
      );
      const page = await ctx.newPage();
      const proto = side === "proto";
      const url = (h, p) => (proto ? `file://${PROTO}${h}` : `${APP}${p}`);
      if (o.user) {
        // Pick the person the way a user would (PIN 1234 for Owner and Finance).
        if (proto) {
          await page.goto(url("#home"));
          await page.waitForTimeout(500);
          await page.evaluate((u) => window.setWho(u), o.user);
        } else if (["u1", "u5"].includes(o.user)) {
          await page.goto(`${APP}/who?pin=${o.user}`);
          await page.waitForSelector(".whobox input");
          await page.fill(".whobox input", "1234");
          await page.click(".whobox .btn.p");
          await page.waitForURL(/\/home/);
        } else {
          await page.goto(`${APP}/who`);
          await page.click(`.whogrid button:has-text("${NAMES[o.user]}")`);
          await page.waitForURL(/\/home/);
        }
        await page.waitForTimeout(300);
      }
      if (o.twice) {
        // The prototype logs "Viewed prices" while drawing, so it shows from the second visit on.
        if (proto) {
          await page.goto(url(hash, path));
          await page.waitForTimeout(300);
          await page.evaluate(() => (location.hash = "#orders"));
          await page.waitForTimeout(300);
        } else {
          await page.goto(url(hash, path));
          await page.waitForTimeout(600);
        }
      }
      if (proto && (o.user || o.twice)) await page.evaluate((h) => (location.hash = h), hash);
      else await page.goto(url(hash, path));
      if (o.gate && proto) {
        await page.waitForSelector("#who:not([hidden])");
        if (o.pin) await page.click(".whogrid button:first-child");
      }
      await page.waitForTimeout(o.wait || 1500);
      if (o.act) await o.act(page, proto);
      if (o.top) await page.evaluate(() => document.getElementById("main").scrollTo({ top: 0 }));
      if (o.menu) {
        await page.click(".mebtn");
        await page.waitForTimeout(400);
      }
      if (o.agent) {
        await page.keyboard.press("Meta+i");
        await page.waitForTimeout(2200);
      }
      if (o.palette) {
        await page.keyboard.press("Meta+k");
        await page.waitForTimeout(500);
      }
      await page.mouse.move(0, 899);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${OUT}/${name}-${theme}-${side}.png` });
      await ctx.close();
    }
    if (PROTO) {
      const n = await diff(`${OUT}/${name}-${theme}-proto.png`, `${OUT}/${name}-${theme}-app.png`, `${OUT}/${name}-${theme}-diff.png`);
      results.push([name, theme, n]);
      console.log(`${n === 0 ? "same" : "DIFF"} ${name} ${theme}: ${n < 0 ? "sizes differ" : `${n} px`}`);
    }
  }
}
await browser.close();
console.log("shots in", OUT);
if (PROTO) console.log(`${results.filter((r) => r[2] === 0).length} of ${results.length} identical`);
