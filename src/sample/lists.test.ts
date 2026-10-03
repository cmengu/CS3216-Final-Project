import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPdf, toRows, validate, type EgcOutputRow } from "@/lib/importer";
import { harbourPo } from "@/test/po";
import { buildLists } from "./lists";
import { CUSTOMERS, PRODUCTS } from ".";
import type { Alias } from "./types";

describe("buildLists", () => {
  const lists = buildLists();

  it("lists every product and customer once", () => {
    expect(lists.skus.map((s) => s.sku).sort()).toEqual(Object.keys(PRODUCTS).sort());
    expect(lists.skus.find((s) => s.sku === "EGC-PTND")).toEqual({ sku: "EGC-PTND", description: "Pea tendrils 35g", unitPrice: 5.4 });
    expect(lists.customers.map((c) => c.customerId).sort()).toEqual(Object.keys(CUSTOMERS).sort());
    expect(lists.customers.find((c) => c.customerId === "C10402")).toEqual({ customerId: "C10402", name: "Riverside Club", location: "Members entrance", deliveryMethod: "Delivery", session: "Unspecified" });
  });

  it("carries approved aliases only", () => {
    const aliases: Alias[] = [
      { text: "pea shoots", sku: "EGC-PTND", state: "approved", by: "May" },
      { text: "mystery leaf", sku: "EGC-MBAS", state: "proposed", by: null },
      { text: "Edible flower mix (tray)", sku: null, state: "proposed", by: null },
    ];
    const texts = buildLists(PRODUCTS, CUSTOMERS, aliases).productAliases.map((a) => a.sourceText);
    expect(texts).toContain("pea shoots");
    expect(texts).not.toContain("mystery leaf");
    expect(texts).not.toContain("Edible flower mix (tray)");
  });

  it("maps every outlet of a customer to its one Customer ID", () => {
    const rows = toRows([harbourPo()], lists);
    expect(rows.map((r) => r.cells.customerId.value)).toEqual(["C10243", "C10243", "C10243"]);
    expect(rows.map((r) => r.source.outlet)).toEqual(["Banquet kitchen", "Banquet kitchen", "Room service"]);
    expect(rows.map((r) => r.cells.location.value)).toEqual(["Loading dock B · Banquet kitchen", "Loading dock B · Banquet kitchen", "Loading dock B · Room service"]);
    expect(rows[0].cells.sku.value).toBe("EGC-PTND"); // approved alias "pea tendrils"
    expect(rows[1].cells.sku.value).toBe("EGC-MBAS"); // the product's own name
    expect(rows[2].cells.sku.origin).toBe("unresolved");
    expect(validate(rows).blockers.some((b) => b.rowId === rows[2].id && b.field === "sku")).toBe(true);
  });
});

describe("the importer's look-alike sample POs", () => {
  const dir = "node_modules/po-importer/fixtures/egc";
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")) as {
    layoutFixtures?: { pdfs: { pdf: string; reader: string | null; expectedRows?: string; expect?: string }[] };
  };
  const pdfs = manifest.layoutFixtures?.pdfs ?? [];

  it.each(pdfs.filter((p) => p.expectedRows))("$pdf maps with the app's own lists exactly as the importer expects", async ({ pdf, reader, expectedRows }) => {
    const name = pdf.split("/").pop()!;
    const result = await readPdf(name, new Uint8Array(readFileSync(`${dir}/${pdf}`)));
    expect(result.status === "parsed" || result.status === "partial").toBe(true);
    if (result.status !== "parsed" && result.status !== "partial") return;
    expect(result.readerId).toBe(reader);
    const expected = JSON.parse(readFileSync(`${dir}/${expectedRows}`, "utf8")) as EgcOutputRow[];
    const rows = toRows([{ sourceId: expected[0].source.sourceId, order: result.order }], buildLists());
    expect(rows).toEqual(expected);
  });

  it.each(pdfs.filter((p) => p.expect))("$pdf is refused", async ({ pdf, expect: status }) => {
    const result = await readPdf(pdf.split("/").pop()!, new Uint8Array(readFileSync(`${dir}/${pdf}`)));
    expect(result.status === "unsupported" && result.reason).toBe(status);
  });
});
