// Side-by-side screenshots of the approved prototype and the app, in both themes.
// Usage: PROTO=/path/to/prototype.html APP=http://localhost:3000 OUT=/tmp/shots node scripts/shots.mjs
// Needs Google Chrome installed (playwright-core drives it with channel "chrome").
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const PROTO = process.env.PROTO;
const APP = process.env.APP || "http://localhost:3000";
const OUT = process.env.OUT || "/tmp/po-tracker-shots";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
mkdirSync(OUT, { recursive: true });

// [name, prototype hash, app path, options]
const SCREENS = [
  ["gate", "#home", "/who", { gate: true }],
  ["pin", "#home", "/who?pin=u1", { gate: true, pin: true }],
  ["home", "#home", "/home", { wait: 6500 }],
  ["home-greet", "#home", "/home", { wait: 1200 }],
  ["menu", "#home", "/home", { wait: 6500, menu: true }],
  ["add", "#add", "/add", {}],
  ["agent", "#home", "/home", { wait: 6500, agent: true }],
  ["palette", "#home", "/home", { wait: 6500, palette: true }],
  ["orders", "#orders", "/orders", {}],
  ["mobile-home", "#home", "/home", { wait: 6500, w: 390, h: 844 }],
  ["owner-home", "#home", "/home", { wait: 6500, user: "u1" }],
];

const browser = await chromium.launch({ channel: "chrome" });
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
      const url = side === "proto" ? `file://${PROTO}${hash}` : `${APP}${path}`;
      await page.goto(url);
      if (o.user) {
        // Pick the person through the UI the way a user would: Switch person -> tile (PIN 1234 for Owner/Finance).
        await page.waitForTimeout(800);
        if (side === "proto") await page.evaluate((u) => window.setWho(u), o.user);
        else {
          await page.goto(`${APP}/who?pin=${o.user}`);
          await page.waitForSelector(".whobox input");
          await page.fill(".whobox input", "1234");
          await page.click(".whobox .btn.p");
          await page.waitForURL(/\/home/);
        }
      }
      if (o.gate && side === "proto") {
        await page.waitForSelector("#who:not([hidden])");
        if (o.pin) await page.click(".whogrid button:first-child");
      }
      await page.waitForTimeout(o.wait || 1500);
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
      await page.screenshot({ path: `${OUT}/${name}-${theme}-${side}.png` });
      await ctx.close();
    }
  }
}
await browser.close();
console.log("shots in", OUT);
