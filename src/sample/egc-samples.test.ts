import { describe, expect, it } from "vitest";
import { SAMPLE_CUSTOMERS, SAMPLE_PRINTED_CUSTOMERS, SAMPLE_PRINTED_ITEMS, SAMPLE_PRODUCTS } from "./egc-samples";
import { buildLists } from "./lists";

/* Holds with the real lists and with the empty file. The test on a real buyer's PO is in egc-samples.private.test.ts, which git ignores. */
describe("the buyers and items on EGC's sample POs", () => {
  const lists = buildLists();

  it("every approved wording points at a listed product and customer", () => {
    for (const a of SAMPLE_PRINTED_ITEMS) {
      expect(SAMPLE_PRODUCTS[a.sku], a.sourceText).toBeDefined();
      expect(SAMPLE_CUSTOMERS[a.customerId!], a.sourceText).toBeDefined();
    }
    for (const a of SAMPLE_PRINTED_CUSTOMERS) expect(SAMPLE_CUSTOMERS[a.customerId], a.buyerName).toBeDefined();
    expect(lists.productAliases).toEqual(expect.arrayContaining(SAMPLE_PRINTED_ITEMS));
  });
});
