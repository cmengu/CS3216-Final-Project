import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import { ackText, ackTextFor, replyOpt } from "./ack-text";

const S = seed();
const o1 = S.orders.find((o) => o.id === "o1")!; // Harbour Hotel, PO HH-2231, Fri 2 Oct, AM, 6 lines
const o3 = S.orders.find((o) => o.id === "o3")!; // WhatsApp, no PO
const style = S.settings.style;

describe("ackText", () => {
  it("defaults to every part on", () => {
    expect(replyOpt(S.settings)).toEqual({ lines: true, date: true, sign: true });
  });

  it("opening line, PO and delivery head, every item, then the sender", () => {
    const t = ackText(o1, { customer: S.customers[o1.cust], style, sender: "May" });
    const [open, body, sign] = t.split("\n\n");
    expect(open).toBe(style);
    const rows = body.split("\n");
    expect(rows[0]).toBe("PO HH-2231 · Delivery Fri, 2 Oct, AM:");
    expect(rows[1]).toBe("• Pea tendrils 35g · 4 box · Banquet kitchen");
    expect(rows).toHaveLength(1 + o1.lines.length);
    expect(sign).toBe("May, Edible Garden City");
  });

  it("drops each part when its toggle is off", () => {
    const c = S.customers[o1.cust];
    expect(ackText(o1, { customer: c, style, sender: "May", reply: { lines: false, date: true, sign: true } })).toBe(
      `${style}\n\nPO HH-2231 · Delivery Fri, 2 Oct, AM\n\nMay, Edible Garden City`,
    );
    expect(ackText(o1, { customer: c, style, sender: "May", reply: { lines: false, date: false, sign: false } })).toBe(`${style}\n\nPO HH-2231`);
    const noDate = ackText(o1, { customer: c, style, sender: "May", reply: { lines: true, date: false, sign: false } });
    expect(noDate.split("\n\n")[1].split("\n")[0]).toBe("PO HH-2231:");
  });

  it("a WhatsApp order has no PO; an unspecified session reads 'time to confirm'", () => {
    const t = ackText(o3, { customer: { slot: "Unspecified" }, style: "Hi", sender: "Eunice", reply: { lines: false, date: true, sign: false } });
    expect(t).toBe("Hi\n\nDelivery Thu, 1 Oct, time to confirm");
  });

  it("an unmatched line uses the PO's own words; an empty opening line is left out", () => {
    const o4 = S.orders.find((o) => o.id === "o4")!;
    const t = ackText(o4, { customer: S.customers[o4.cust], style: "", sender: "May", reply: { lines: true, date: false, sign: false } });
    expect(t).toBe("PO RC-0917:\n• Pea tendrils 35g · 3 box · Clubhouse\n• Edible flower mix (tray) · 2 tray · Clubhouse");
  });

  it("ackTextFor signs as the person working now and reads the saved options", () => {
    const s = seed();
    s.user = "u1";
    s.settings.reply = { lines: false, date: false, sign: true };
    expect(ackTextFor(s, o1)).toBe(`${style}\n\nPO HH-2231\n\nMay, Edible Garden City`);
  });
});
