import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import type { DemoState, Person, Role } from "@/sample";
import { ackTextFor } from "@/lib/ack-text";
import { activityByDay, groupOrders, mineOf, orderText, richText, sourceRows, stepsOf, summarise, tabsFor, whyText } from "./logic";

const S = seed();
const by = (role: Role): Person => S.people.find((p) => p.role === role)!;
const order = (s: DemoState, id: string) => s.orders.find((o) => o.id === id)!;
const evOf = (s: DemoState, id: string) => s.events.filter((e) => e.order === id);

describe("tabsFor", () => {
  it("counts every state and hides Draft and Overdue when empty", () => {
    const { tabs, counts } = tabsFor(S.orders);
    expect(tabs.map((t) => t[0])).toEqual(["all", "needs_check", "blocked", "confirmed", "delivered"]);
    expect(counts).toMatchObject({ all: 12, needs_check: 1, blocked: 1, confirmed: 2, delivered: 8, draft: 0, overdue: 0 });
  });

  it("puts Overdue then Draft after All when they have orders", () => {
    const s = seed();
    order(s, "o4").state = "draft";
    order(s, "o4").date = "2026-09-20";
    order(s, "o1").date = "2026-09-20";
    const { tabs, counts } = tabsFor(s.orders);
    expect(tabs.slice(0, 3).map((t) => t[0])).toEqual(["all", "overdue", "draft"]);
    expect(counts.overdue).toBe(1);
  });

  it("counts only an account manager's customers", () => {
    expect(tabsFor(mineOf(S, by("account_manager"))).counts.all).toBe(8);
  });
});

describe("groupOrders", () => {
  it("groups by delivery day in the prototype's order", () => {
    const g = groupOrders(S.orders, S.customers, "all", "", "date");
    expect(g.map((x) => [x.k, x.items.length])).toEqual([
      ["Today", 2],
      ["Tomorrow", 2],
      ["This week", 1],
      ["Earlier this week", 2],
      ["Earlier", 5],
    ]);
    expect(g[0].items.map((o) => o.id)).toEqual(["o3", "o5"]);
  });

  it("filters by tab and customer", () => {
    expect(groupOrders(S.orders, S.customers, "blocked", "", "date").flatMap((g) => g.items.map((o) => o.id))).toEqual(["o4"]);
    expect(groupOrders(S.orders, S.customers, "all", "C10388", "date").flatMap((g) => g.items.map((o) => o.id))).toEqual(["o3", "o9"]);
    expect(groupOrders(S.orders, S.customers, "draft", "", "date")).toEqual([]);
  });

  it("groups by customer name and by status label", () => {
    expect(groupOrders(S.orders, S.customers, "all", "", "customer").map((g) => g.k)).toEqual([
      "Harbour Hotel",
      "Marina Grand",
      "Orchard Deli",
      "Pavilion Kitchen",
      "Riverside Club",
    ]);
    expect(groupOrders(S.orders, S.customers, "all", "", "state").map((g) => g.k)).toEqual(["Blocked", "Confirmed", "Delivered", "Needs check"]);
  });
});

describe("row text", () => {
  it("explains a revision, a missing SKU, or lists lines and outlets", () => {
    expect(whyText(order(S, "o2"))).toBe("qty 4 → 6 on line 1, unconfirmed");
    expect(whyText(order(S, "o4"))).toBe("1 cell has no SKU");
    expect(whyText(order(S, "o1"))).toBe("6 lines · Banquet kitchen, Room service");
  });

  it("copies lines as tab-separated text", () => {
    expect(orderText(order(S, "o4"), S.customers.C10402)).toBe(
      "Riverside Club · RC-0917 · Mon, 5 Oct Unspecified\nEGC-PTND\tPea tendrils 35g\t3 box\tClubhouse\n—\tEdible flower mix (tray)\t2 tray\tClubhouse",
    );
  });
});

describe("summarise", () => {
  it("reads like the prototype for each state", () => {
    const t = (id: string) => richText(summarise(order(S, id), evOf(S, id)));
    expect(t("o2")).toBe("Revised PO received 10:48. Line 1 qty 4 → 6, unconfirmed.");
    expect(t("o4")).toBe("One cell has no SKU. Export is blocked until it is filled.");
    expect(t("o1")).toBe("Confirmed by Eunice today 09:40, exported. Deliver Fri, 2 Oct.");
    expect(t("o6")).toBe("Confirmed by Eunice 28 sept 09:20, exported. Delivered, invoiced INV-2609-014.");
    expect(t("o7")).toBe("Confirmed by Eunice 25 sept 10:31, exported. Delivered, not yet invoiced.");
  });
});

describe("stepsOf", () => {
  const classes = (id: string) => stepsOf(order(S, id), evOf(S, id)).map((s) => s.cls);
  it("marks the first open step, and a changed order as stopped", () => {
    expect(classes("o1")).toEqual(["done", "done", "done", "now", ""]);
    expect(classes("o2")).toEqual(["done", "stop", "done", "now", ""]);
    expect(classes("o4")).toEqual(["done", "stop", "", "", ""]);
    expect(classes("o6")).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("shows when each done step happened, and why a step stopped", () => {
    expect(stepsOf(order(S, "o2"), evOf(S, "o2"))[1].small).toBe("Yesterday 16:20");
    expect(stepsOf(order(S, "o4"), evOf(S, "o4"))[1].small).toBe("blocked");
  });
});

describe("activityByDay", () => {
  it("sorts by time, groups by day and hides price views from those without prices", () => {
    const ev = [...evOf(S, "o2"), { order: "o2", at: "2026-10-01 09:00", kind: "price_viewed", actor: "Eunice", text: "Viewed prices" }];
    const all = activityByDay(ev, true);
    expect(all.map((g) => [g.d, g.items.length])).toEqual([
      ["2026-09-30", 3],
      ["2026-10-01", 3],
    ]);
    expect(activityByDay(ev, false)[1].items.map((e) => e.kind)).toEqual(["received_again", "revision_proposed"]);
  });
});

describe("ackText (the shared one, as Suggest reply uses it)", () => {
  it("builds the acknowledgement from the opening line, PO, delivery, items and sender", () => {
    const s = seed();
    s.user = by("coordinator").id;
    expect(ackTextFor(s, order(s, "o2"))).toBe(
      [
        "Hi Chef, received your order, thanks! Delivering as below.",
        "PO 4810286013 · Delivery Fri, 2 Oct, AM:\n• Pea tendrils 35g · 6 box · Kitchen #1\n• Micro basil 50g · 4 box · Kitchen #1\n• Elderflower 30g · 2 box · Madame Fan\n• Edible flower mix 50g · 2 box · Room service",
        `${by("coordinator").name}, Edible Garden City`,
      ].join("\n\n"),
    );
  });

  it("follows the reply options and says 'time to confirm' for an unspecified slot", () => {
    const s = seed();
    s.settings.reply = { lines: false, date: true, sign: false };
    expect(ackTextFor(s, order(s, "o4"))).toBe("Hi Chef, received your order, thanks! Delivering as below.\n\nPO RC-0917 · Delivery Mon, 5 Oct, time to confirm");
  });
});

describe("source card", () => {
  it("lists the source as file, layout, read and fingerprint, or the WhatsApp equivalents", () => {
    expect(sourceRows(order(S, "o2"), S.customers.C10310)).toEqual([
      ["File", "4810286013.pdf"],
      ["Layout", "Marina platform"],
      ["Read", "2026-09-30 16:02"],
      ["Fingerprint", "b27e5d14"],
    ]);
    expect(sourceRows(order(S, "o3"), S.customers.C10388)[0]).toEqual(["Channel", "WhatsApp paste"]);
  });

  it("names the layout reader that read a PDF from Add orders", () => {
    const o = { ...order(S, "o2"), file: { ...order(S, "o2").file!, layout: "Hotel platform" } };
    expect(sourceRows(o, S.customers.C10310)[1]).toEqual(["Layout", "Hotel platform"]);
  });
});
