import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import type { Person, Role } from "@/sample";
import { paletteHits } from "./palette";

const S = seed();
const by = (role: Role): Person => S.people.find((p) => p.role === role)!;

describe("⌘K palette", () => {
  it("with nothing typed: four orders, three customers, the pages and actions this person may use", () => {
    const h = paletteHits(S, by("coordinator"), "");
    expect(h.filter((x) => x.kind === "order")).toHaveLength(4);
    expect(h.filter((x) => x.kind === "customer")).toHaveLength(3);
    expect(h.filter((x) => x.kind === "action").map((x) => (x.kind === "action" ? x.label : ""))).toEqual(["Add orders", "Ask the assistant", "Toggle theme"]);
  });

  it("finds orders by PO number, customer name or state", () => {
    const po = paletteHits(S, by("coordinator"), "hh-22");
    expect(po.filter((x) => x.kind === "order").every((x) => x.kind === "order" && x.ref.startsWith("HH-22"))).toBe(true);
    const name = paletteHits(S, by("coordinator"), "marina");
    expect(name.filter((x) => x.kind === "order").length).toBe(3);
    expect(name.find((x) => x.kind === "customer")).toMatchObject({ name: "Marina Grand", m: "C10310" });
    const st = paletteHits(S, by("coordinator"), "blocked");
    expect(st.filter((x) => x.kind === "order").map((x) => x.kind === "order" && x.id)).toEqual(["o4"]);
  });

  it("an account manager only finds their own customers and orders", () => {
    const dennis = by("account_manager");
    const h = paletteHits(S, dennis, "");
    expect(h.filter((x) => x.kind === "customer").map((x) => x.kind === "customer" && x.id)).toEqual(["C10243", "C10310"]);
    const other = paletteHits(S, dennis, "riverside");
    expect(other).toEqual([{ g: "Ask", kind: "ask", text: "riverside", m: "" }]);
  });

  it("the packing lead has no Add orders and no Invoices", () => {
    const h = paletteHits(S, by("packing"), "");
    expect(h.some((x) => x.kind === "action" && x.action === "add")).toBe(false);
    expect(h.some((x) => x.kind === "page" && (x.nav.key === "add" || x.nav.key === "invoices"))).toBe(false);
  });

  it("nothing found offers to ask the assistant with the words as typed", () => {
    expect(paletteHits(S, by("owner"), "  qwerty ")).toEqual([{ g: "Ask", kind: "ask", text: "  qwerty ", m: "" }]);
  });
});
