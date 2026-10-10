import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import type { Person, Role } from "@/sample";
import { canDeliver, canEdit, canInvoice, canPrice, isOwner, lines, navAllowed, needsPin, visibleOrders } from "./access";

const S = seed();
const by = (role: Role): Person => S.people.find((p) => p.role === role)!;

// The role table from the build spec: Orders, Prices, Add and confirm, Invoices, People/Settings, PIN.
const TABLE: Record<Role, { all: boolean; price: boolean; edit: boolean; invoice: boolean; owner: boolean; pin: boolean; deliver: boolean }> = {
  owner: { all: true, price: true, edit: true, invoice: true, owner: true, pin: true, deliver: true },
  coordinator: { all: true, price: true, edit: true, invoice: false, owner: false, pin: false, deliver: true },
  account_manager: { all: false, price: false, edit: false, invoice: false, owner: false, pin: false, deliver: false },
  packing: { all: true, price: false, edit: false, invoice: false, owner: false, pin: false, deliver: true },
  finance: { all: true, price: true, edit: false, invoice: true, owner: false, pin: true, deliver: false },
};

describe("role helpers match the role table", () => {
  for (const [role, want] of Object.entries(TABLE) as [Role, (typeof TABLE)[Role]][]) {
    it(role, () => {
      const p = by(role);
      expect(canPrice(p)).toBe(want.price);
      expect(canEdit(p)).toBe(want.edit);
      expect(canInvoice(p)).toBe(want.invoice);
      expect(isOwner(p)).toBe(want.owner);
      expect(needsPin(p)).toBe(want.pin);
      expect(canDeliver(p)).toBe(want.deliver);
      expect(visibleOrders(S.orders, p).length === S.orders.length).toBe(want.all);
    });
  }
});

describe("visibleOrders", () => {
  it("keeps an account manager to their own customers", () => {
    const dennis = by("account_manager");
    const seen = visibleOrders(S.orders, dennis);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((o) => ["C10243", "C10310"].includes(o.cust))).toBe(true);
  });
});

describe("lines", () => {
  const o1 = S.orders.find((o) => o.id === "o1")!;
  const o4 = S.orders.find((o) => o.id === "o4")!;

  it("adds unit price and total for price roles", () => {
    const ls = lines(o1, by("finance"));
    expect(ls[0]).toMatchObject({ sku: "EGC-PTND", qty: 4, unitPrice: 5.4 });
    expect((ls[0] as { total: number }).total).toBeCloseTo(21.6);
  });

  it("strips every price field for packing and account managers", () => {
    for (const role of ["packing", "account_manager"] as Role[]) {
      for (const l of lines(o1, by(role))) {
        expect(l).not.toHaveProperty("unitPrice");
        expect(l).not.toHaveProperty("total");
        expect(JSON.stringify(l)).not.toMatch(/price|total/i);
      }
    }
  });

  it("strips price fields even if the input already carries them", () => {
    const priced = { lines: lines(o1, by("owner")) };
    for (const l of lines(priced, by("packing"))) expect(l).not.toHaveProperty("unitPrice");
  });

  it("leaves a line with no SKU unpriced", () => {
    const ls = lines(o4, by("owner"));
    expect(ls[1]).toMatchObject({ sku: null, unitPrice: null, total: null });
  });
});

describe("navAllowed", () => {
  it("hides Invoices, People and Settings by role", () => {
    expect(navAllowed("invoices", by("finance"))).toBe(true);
    expect(navAllowed("invoices", by("coordinator"))).toBe(false);
    expect(navAllowed("people", by("owner"))).toBe(true);
    expect(navAllowed("settings", by("finance"))).toBe(false);
    expect(navAllowed("home", by("account_manager"))).toBe(true);
  });
});
