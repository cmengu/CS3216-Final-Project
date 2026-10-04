import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import type { Person, Role } from "@/sample";
import { canInvoice } from "@/platform/access";
import { applyInvoice, applyInvoiceAll } from "@/state/actions/invoices";
import { applyAddNote, nowStr } from "@/state/actions/customers";
import { deliveredOn, groupByCustomer, invoiceCsv, invoiceLists, listTotal } from "./invoices";

const by = (s: ReturnType<typeof seed>, role: Role): Person => s.people.find((p) => p.role === role)!;
const as = (role: Role) => {
  const s = seed();
  s.user = by(s, role).id;
  return s;
};

describe("invoice lists", () => {
  it("splits delivered orders into to invoice and invoiced", () => {
    const s = seed();
    const { open, done } = invoiceLists(s, by(s, "finance"));
    expect(open.map((o) => o.id)).toEqual(["o5", "o7"]);
    expect(done.map((o) => o.id)).toEqual(["o6", "o8", "o9", "o10", "o11", "o12"]);
  });

  it("groups by customer in first-seen order, newest first, with group totals", () => {
    const s = seed();
    const g = groupByCustomer(invoiceLists(s, by(s, "owner")).done);
    expect(g.map((x) => x.cust)).toEqual(["C10243", "C10388", "C10310"]);
    expect(g[0].orders.map((o) => o.id)).toEqual(["o6", "o8", "o11", "o12"]);
    expect(g[1].total).toBeCloseTo(2 * 8.4 + 6.2);
  });

  it("totals the tab before GST", () => {
    const s = seed();
    const { open } = invoiceLists(s, by(s, "finance"));
    // o5: 2 wood sorrel + 1 red veined sorrel; o7: 6 pea tendrils + 2 elderflower.
    expect(listTotal(open)).toBeCloseTo(2 * 5.2 + 5.8 + (6 * 5.4 + 2 * 8.4));
  });

  it("dates the row by the delivered event, falling back to the delivery date", () => {
    const s = seed();
    const o5 = s.orders.find((o) => o.id === "o5")!;
    expect(deliveredOn(s.events, o5)).toBe("2026-10-01");
    expect(deliveredOn([], o5)).toBe(o5.date);
  });
});

describe("Copy CSV", () => {
  it("copies the tab on screen with totals and invoice numbers", () => {
    const s = seed();
    const csv = invoiceCsv(s, by(s, "finance"), "open").split("\n");
    expect(csv[0]).toBe("Customer,Customer ID,PO,Delivered,Lines,Total,Invoice");
    expect(csv[1]).toBe("Orchard Deli,C10419,OD-2210,2026-10-01,2,16.20,");
    expect(csv).toHaveLength(3);
    const done = invoiceCsv(s, by(s, "finance"), "done").split("\n");
    expect(done[3]).toBe("Pavilion Kitchen,C10388,WA-0924-88,2026-09-24,2,23.00,INV-2609-010");
  });

  it("leaves the total blank for a role without prices", () => {
    const s = seed();
    const csv = invoiceCsv(s, by(s, "packing"), "open").split("\n");
    expect(csv[1]).toBe("Orchard Deli,C10419,OD-2210,2026-10-01,2,,");
  });
});

describe("Mark invoiced", () => {
  it("numbers from the sequence and writes the event and the history entry", () => {
    const s = as("finance");
    const n = applyInvoice(s, "o5", "2026-10-01 14:05");
    expect(n).toBe("INV-2610-200");
    expect(s.seq).toBe(101);
    expect(s.orders.find((o) => o.id === "o5")!.invoiced).toBe("INV-2610-200");
    expect(s.events.at(-1)).toEqual({ order: "o5", at: "2026-10-01 14:05", kind: "invoiced", actor: "Farah", text: "Invoiced INV-2610-200" });
    expect(s.history.at(-1)).toEqual({ at: "2026-10-01 14:05", who: "Farah", kind: "invoiced", order: "o5", text: "Invoiced INV-2610-200" });
    expect(invoiceLists(s, by(s, "finance")).open.map((o) => o.id)).toEqual(["o7"]);
  });

  it("does nothing twice, nor for an order not delivered", () => {
    const s = as("owner");
    applyInvoice(s, "o5");
    expect(applyInvoice(s, "o5")).toBeNull();
    expect(applyInvoice(s, "o1")).toBeNull();
    expect(s.seq).toBe(101);
  });

  it("refuses roles that cannot invoice", () => {
    for (const role of ["coordinator", "account_manager", "packing"] as Role[]) {
      const s = as(role);
      expect(canInvoice(by(s, role))).toBe(false);
      expect(applyInvoice(s, "o5")).toBeNull();
      expect(applyInvoiceAll(s)).toBe(0);
      expect(s.events).toHaveLength(seed().events.length);
    }
  });

  it("Mark all invoices every open order with consecutive numbers", () => {
    const s = as("owner");
    expect(applyInvoiceAll(s, "2026-10-01 15:00")).toBe(2);
    expect(s.orders.filter((o) => o.state === "delivered" && !o.invoiced)).toHaveLength(0);
    expect(s.events.slice(-2).map((e) => e.text)).toEqual(["Invoiced INV-2610-200", "Invoiced INV-2610-201"]);
    expect(s.history).toHaveLength(2);
  });
});

describe("standing note", () => {
  it("adds the note and writes the history entry the prototype writes", () => {
    const s = as("coordinator");
    expect(applyAddNote(s, "C10310", "  Gate code 4411  ", "2026-10-01 09:00")).toBe(true);
    expect(s.customers.C10310.notes).toEqual(["Gate code 4411"]);
    expect(s.history).toEqual([{ at: "2026-10-01 09:00", who: "Eunice", kind: "note_added", order: null, text: "Standing note on Marina Grand" }]);
  });
  it("is for roles that can edit", () => {
    for (const role of ["account_manager", "packing", "finance"] as Role[]) {
      const s = as(role);
      expect(applyAddNote(s, "C10243", "x")).toBe(false);
      expect(s.history).toHaveLength(0);
    }
  });
  it("ignores an empty note", () => {
    const s = seed();
    expect(applyAddNote(s, "C10310", "   ")).toBe(false);
    expect(s.history).toHaveLength(0);
  });
  it("stamps the demo's fixed day with the time of day", () => {
    expect(nowStr(new Date(2030, 0, 5, 7, 3))).toBe("2026-10-01 07:03");
  });
});
