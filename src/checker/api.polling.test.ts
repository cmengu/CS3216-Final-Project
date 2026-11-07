/** Run against a local dev server with INVOICE_BROWSER_URL=http://localhost:3000. */
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";

const appUrl = process.env.INVOICE_BROWSER_URL;

describe.skipIf(!appUrl)("invoice polling in the browser", () => {
  it("retains a rejected upload and lets the user retry it or cancel waiting files", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.INVOICE_BROWSER_EXECUTABLE });
    try {
      const page = await browser.newPage();
      const origin = new URL(appUrl!).origin;
      const apiUrl = process.env.INVOICE_BROWSER_API ?? "http://localhost:8001";
      const projectId = "synthetic-upload-recovery";
      const rows = [{
        id: "11111111-1111-4111-8111-111111111111", project_id: projectId,
        comparison_mode: "totals_only", filename: "existing.xml", status: "queued", mode: "live",
        created_at: "2026-11-06T13:00:00Z", updated_at: "2026-11-06T13:00:00Z",
        price_sheet_version: "", error: null, invoice: null, check: null, document: null,
      }];
      let attempts = 0;
      await page.route(`${apiUrl}/**`, async route => {
        const url = new URL(route.request().url());
        const headers = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "*" };
        const send = (body: unknown) => route.fulfill({ headers, json: body });
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        if (url.pathname === "/auth/me") return send({ authenticated: true, user: { email: "synthetic@example.com", role: "member" } });
        if (url.pathname === "/projects") return send([{
          id: projectId, name: "Synthetic upload recovery", comparison_mode: "totals_only",
          created_at: rows[0].created_at, has_master_list: false, invoice_count: rows.length,
          included_count: 0, excluded_count: 0, totals: {},
        }]);
        if (url.pathname === "/invoices") return send(rows);
        if (url.pathname === "/invoice-batches") {
          if (route.request().method() === "HEAD") return route.fulfill({ status: 204, headers: { ...headers, "X-Invoice-Batch-Limit": "500", "access-control-expose-headers": "X-Invoice-Batch-Limit" } });
          ++attempts;
          if (attempts !== 2) return route.fulfill({ status: 422, headers, json: { detail: "Synthetic rejection" } });
          const accepted = { ...rows[0], id: "22222222-2222-4222-8222-222222222222", filename: "retry.xml" };
          rows.push(accepted);
          return send({ id: "synthetic-batch", invoices: [accepted], duplicates: [], processing: "background" });
        }
        return send([]);
      });
      await page.goto(`${origin}/invoices?project=${projectId}`);
      await expect.poll(() => page.locator(".ic-qcard").count(), { timeout: 30_000 }).toBe(1);
      await page.locator('input[type="file"]').setInputFiles({ name: "retry.xml", mimeType: "application/xml", buffer: Buffer.from("synthetic invoice") });
      const retry = page.getByRole("button", { name: "Retry uploads", exact: true });
      await retry.waitFor();
      expect(attempts).toBe(1);
      await retry.click();
      await expect.poll(() => page.locator(".ic-qcard").count()).toBe(2);
      expect(attempts).toBe(2);
      await page.locator('input[type="file"]').setInputFiles({ name: "cancel.xml", mimeType: "application/xml", buffer: Buffer.from("another synthetic invoice") });
      const cancel = page.getByRole("button", { name: "Cancel waiting uploads", exact: true });
      await cancel.waitFor();
      expect(attempts).toBe(3);
      await cancel.click();
      expect(await retry.count()).toBe(0);
      expect(await page.getByText("Waiting to upload…", { exact: false }).count()).toBe(0);
    } finally { await browser.close(); }
  }, 45_000);

  it("shows completed invoices when both pages take longer than the polling interval", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.INVOICE_BROWSER_EXECUTABLE });
    try {
      const page = await browser.newPage();
      const origin = new URL(appUrl!).origin;
      const apiUrl = process.env.INVOICE_BROWSER_API ?? "http://localhost:8001";
      const projectId = "synthetic-polling-test";
      const rows = Array.from({ length: 174 }, (_, index) => ({
        id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
        project_id: projectId, comparison_mode: "totals_only",
        filename: `synthetic-${index}.xml`, status: "queued", mode: "live",
        created_at: "2026-11-06T13:00:00Z", updated_at: "2026-11-06T13:00:00Z",
        price_sheet_version: "", error: null, invoice: null, check: null, document: null,
      }));
      let completed = false;
      let pending = 0;
      let maxPending = 0;
      await page.route(`${apiUrl}/**`, async route => {
        const request = route.request();
        const url = new URL(request.url());
        const headers = {
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "*",
        };
        const send = (body: unknown) => route.fulfill({ headers, json: body });
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        if (url.pathname === "/auth/me") return send({ authenticated: true, user: { email: "synthetic@example.com", role: "member" } });
        if (url.pathname === "/health") return send({ status: "ok", mode: "live", processing_configured: true });
        if (url.pathname === "/projects") return send([{
          id: projectId, name: "Synthetic polling test", comparison_mode: "totals_only",
          created_at: rows[0].created_at, has_master_list: false, invoice_count: 174,
          included_count: 0, excluded_count: 0, totals: {},
        }]);
        if (url.pathname === "/invoices") {
          maxPending = Math.max(maxPending, ++pending);
          try {
            if (completed) await new Promise(resolve => setTimeout(resolve, 4_000));
            const offset = Number(url.searchParams.get("offset") ?? 0);
            return await send(rows.slice(offset, offset + 100).map(row => completed ? {
              ...row, status: "completed", updated_at: "2026-11-06T13:01:00Z",
              invoice: { supplier_name: "Synthetic Supplier", invoice_number: "SYNTHETIC",
                invoice_date: "2026-11-06", currency: "VND", subtotal: "20.25",
                tax: "1.62", invoice_total: "21.87", lines: [] },
            } : row));
          } finally { --pending; }
        }
        return send([]);
      });
      await page.goto(`${origin}/invoices?project=${projectId}`);
      const cards = page.locator(".ic-qcard");
      await expect.poll(() => cards.filter({ hasText: "Queued" }).count(), { timeout: 30_000 }).toBe(174);
      maxPending = 0;
      completed = true;
      await expect.poll(() => cards.filter({ hasText: "Synthetic Supplier" }).count(), { timeout: 25_000 }).toBe(174);
      expect(await cards.filter({ hasText: "Queued" }).count()).toBe(0);
      expect(maxPending).toBe(1);
    } finally { await browser.close(); }
  }, 65_000);

  it("recovers from the reload timeout without showing an empty workspace as a new account", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.INVOICE_BROWSER_EXECUTABLE });
    try {
      const page = await browser.newPage();
      const origin = new URL(appUrl!).origin;
      const apiUrl = process.env.INVOICE_BROWSER_API ?? "http://localhost:8001";
      const projectId = "synthetic-timeout-test";
      const attempts = { projects: 0, invoices: 0 };
      const row = {
        id: "11111111-1111-4111-8111-111111111111", project_id: projectId,
        comparison_mode: "totals_only", filename: "synthetic.xml", status: "completed", mode: "live",
        created_at: "2026-11-06T13:00:00Z", updated_at: "2026-11-06T13:01:00Z",
        price_sheet_version: "", error: null, check: null, document: null,
        invoice: { supplier_name: "Recovered Supplier", invoice_number: "SYNTHETIC",
          invoice_date: "2026-11-06", currency: "VND", subtotal: "20.25", tax: "1.62",
          invoice_total: "21.87", lines: [] },
      };
      await page.route(`${apiUrl}/**`, async route => {
        const url = new URL(route.request().url());
        const headers = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "*" };
        const send = (body: unknown) => route.fulfill({ headers, json: body });
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        if (url.pathname === "/auth/me") return send({ authenticated: true, user: { email: "synthetic@example.com", role: "member" } });
        if (url.pathname === "/health") return send({ status: "ok", mode: "live", processing_configured: true });
        if (url.pathname === "/projects") {
          if (++attempts.projects === 1) await new Promise(resolve => setTimeout(resolve, 16_000));
          return send([{ id: projectId, name: "Recovered group", comparison_mode: "totals_only",
            created_at: row.created_at, has_master_list: false, invoice_count: 1,
            included_count: 1, excluded_count: 0, totals: { VND: "21.87" } }]).catch(() => {});
        }
        if (url.pathname === "/invoices") {
          if (++attempts.invoices === 1) await new Promise(resolve => setTimeout(resolve, 16_000));
          return send([row]).catch(() => {});
        }
        return send([]);
      });
      await page.goto(`${origin}/invoices?project=${projectId}`);
      await expect.poll(() => page.getByText("The checking service took too long to respond. Try again.", { exact: true }).count(), { timeout: 20_000 }).toBe(1);
      expect(await page.getByText("Create an invoice group to add invoices.", { exact: true }).count()).toBe(0);
      await expect.poll(() => page.locator(".ic-qcard").filter({ hasText: "Recovered Supplier" }).count(), { timeout: 15_000 }).toBe(1);
      expect(attempts.invoices).toBe(2);
      expect(attempts.projects).toBeLessThanOrEqual(3);
    } finally { await browser.close(); }
  }, 55_000);

  it("bounds a minute of batch traffic and pauses polling in a hidden tab", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.INVOICE_BROWSER_EXECUTABLE });
    try {
      const page = await browser.newPage();
      const origin = new URL(appUrl!).origin;
      const apiUrl = process.env.INVOICE_BROWSER_API ?? "http://localhost:8001";
      const projectId = "synthetic-load-test";
      const rows = Array.from({ length: 174 }, (_, index) => ({
        id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
        project_id: projectId, comparison_mode: "totals_only", filename: `synthetic-${index}.xml`,
        status: "queued", mode: "live", created_at: "2026-11-06T12:55:00Z", updated_at: "2026-11-06T12:55:00Z",
        price_sheet_version: "", error: null, invoice: null, check: null, document: null,
      }));
      let completed = 0;
      const counts = { summaries: 0, pages: 0, individual: 0, projects: 0 };
      const full = (row: typeof rows[number]) => Number(row.id.slice(-12)) < completed ? {
        ...row, status: "completed", updated_at: "2026-11-06T12:56:00Z",
        invoice: { supplier_name: "Synthetic Supplier", invoice_number: "SYNTHETIC", invoice_date: "2026-11-06",
          currency: "VND", subtotal: "20.25", tax: "1.62", invoice_total: "21.87", lines: [] },
      } : row;
      await page.route(`${apiUrl}/**`, async route => {
        const url = new URL(route.request().url());
        const headers = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "*" };
        const send = (body: unknown) => route.fulfill({ headers, json: body });
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        if (url.pathname === "/auth/me") return send({ authenticated: true, user: { email: "synthetic@example.com", role: "member" } });
        if (url.pathname === "/health") return send({ status: "ok", mode: "live", processing_configured: true });
        if (url.pathname === "/projects") {
          ++counts.projects;
          return send([{ id: projectId, name: "Synthetic load test", comparison_mode: "totals_only", created_at: rows[0].created_at,
            has_master_list: false, invoice_count: 174, included_count: completed, excluded_count: 174 - completed, totals: {} }]);
        }
        if (url.pathname === "/invoices") {
          const offset = Number(url.searchParams.get("offset") ?? 0);
          const details = url.searchParams.get("include_details") === "true";
          ++counts[details ? "pages" : "summaries"];
          const result = rows.slice(offset, offset + 100).map(full);
          return send(details ? result : result.map(record => {
            const row: Partial<typeof record> = { ...record };
            delete row.invoice; delete row.check; delete row.document;
            return row;
          }));
        }
        if (url.pathname.startsWith("/invoices/")) { ++counts.individual; return send(full(rows[0])); }
        return send([]);
      });
      await page.goto(`${origin}/invoices?project=${projectId}`);
      const cards = page.locator(".ic-qcard");
      await expect.poll(() => cards.count(), { timeout: 30_000 }).toBe(174);
      await page.waitForTimeout(300);
      await page.clock.install();
      Object.assign(counts, { summaries: 0, pages: 0, individual: 0, projects: 0 });
      for (let second = 3; second <= 60; second += 3) {
        completed = Math.floor(second / 3) * 4;
        await page.clock.runFor(3_000);
        await page.waitForTimeout(750);
      }
      expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(60);
      expect(counts.individual).toBe(0);
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const before = { ...counts };
      await page.clock.runFor(60_000);
      expect(counts).toEqual(before);
      completed = 174;
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.clock.runFor(1);
      await expect.poll(() => cards.filter({ hasText: "Synthetic Supplier" }).count(), { timeout: 10_000 }).toBe(174);
    } finally { await browser.close(); }
  }, 65_000);

  it("does not reload every group's master-list history when invoice totals change", async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.INVOICE_BROWSER_EXECUTABLE });
    try {
      const page = await browser.newPage();
      await page.clock.install();
      const origin = new URL(appUrl!).origin;
      const apiUrl = process.env.INVOICE_BROWSER_API ?? "http://localhost:8001";
      let invoiceReads = 0;
      let groupReads = 0;
      let historyReads = 0;
      await page.route(`${apiUrl}/**`, async route => {
        const url = new URL(route.request().url());
        const headers = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "*" };
        const send = (body: unknown) => route.fulfill({ headers, json: body });
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        if (url.pathname === "/auth/me") return send({ authenticated: true, user: { email: "synthetic@example.com", role: "member" } });
        if (url.pathname === "/projects") {
          ++groupReads;
          return send(Array.from({ length: 12 }, (_, i) => ({ id: `synthetic-${i}`, name: `Synthetic group ${i}`, comparison_mode: "master_list",
            created_at: "2026-11-06T12:55:00Z", has_master_list: true, invoice_count: 174,
            included_count: groupReads, excluded_count: 174 - groupReads, totals: {} })));
        }
        if (url.pathname === "/invoices") {
          ++invoiceReads;
          return send([{
            id: "11111111-1111-4111-8111-111111111111", project_id: "synthetic-0", comparison_mode: "master_list",
            filename: "synthetic.xml", status: "reading", mode: "live", created_at: "2026-11-06T12:55:00Z",
            updated_at: `2026-11-06T12:55:${String(invoiceReads).padStart(2, "0")}Z`,
            price_sheet_version: "synthetic", error: null, invoice: null, check: null, document: null,
          }]);
        }
        if (url.pathname === "/master-list/events") { ++historyReads; return send([]); }
        return send([]);
      });
      await page.goto(`${origin}/audit`);
      await expect.poll(() => historyReads, { timeout: 30_000 }).toBe(12);
      await page.waitForTimeout(500);
      const before = groupReads;
      for (let poll = 0; poll < 4; poll++) {
        await page.clock.runFor(5_000);
        await page.waitForTimeout(500);
      }
      expect(groupReads).toBeGreaterThan(before);
      expect(historyReads).toBe(12);
    } finally { await browser.close(); }
  }, 45_000);
});
