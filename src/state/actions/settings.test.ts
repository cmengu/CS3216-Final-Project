import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import { MAIL0 } from "@/sample/mail";
import { mailbox } from "@/platform/nav";
import { conn, connOn, mailboxFiles, mailboxOn, pasteOn, waLiveOn } from "@/state/selectors/connections";
import {
  aliasNo,
  aliasOk,
  aliasSet,
  checkMail,
  connectMail,
  createKey,
  demoKey,
  disconnectMail,
  dropExport,
  exportImported,
  mailFlow,
  revokeKey,
  setSkuList,
  setWa,
  skuRows,
  toggleReply,
  togglePaste,
} from "./settings";

describe("connections", () => {
  it("all three start off", () => {
    const s = seed();
    expect(conn(s)).toEqual({ mail: null, mailFlow: null, paste: false, wa: null });
    expect([mailboxOn(s), pasteOn(s), waLiveOn(s), connOn(s)]).toEqual([false, false, false, 0]);
    expect(mailboxFiles(s)).toEqual([]);
  });

  it("orders mailbox: pick, sign in, allow, then the waiting PDFs show; disconnect clears them", () => {
    const s = seed();
    mailFlow(s, "pick");
    mailFlow(s, "Gmail");
    expect(mailboxOn(s)).toBe(false);
    connectMail(s, "Gmail", "11:40");
    expect(s.cx).toEqual({ mail: { kind: "Gmail", at: "11:40" }, mailFlow: null, paste: false, wa: null });
    expect(mailboxFiles(s).map((m) => m.file)).toEqual(MAIL0.map((m) => m.file));
    expect(mailbox(s)).toHaveLength(3);
    checkMail(s, "12:05");
    expect(s.cx.mail?.at).toBe("12:05");
    expect(connOn(s)).toBe(1);
    disconnectMail(s);
    expect([mailboxOn(s), s.mailbox, connOn(s)]).toEqual([false, null, 0]);
  });

  it("WhatsApp live only counts once it is waiting for Meta", () => {
    const s = seed();
    for (const v of ["ask", "no", "qr"]) {
      setWa(s, v);
      expect(waLiveOn(s)).toBe(false);
    }
    setWa(s, "pending");
    togglePaste(s);
    expect(connOn(s)).toBe(2);
    setWa(s, null);
    expect(connOn(s)).toBe(1);
  });

  it("the sample export links three messages and adds one change, once", () => {
    const s = seed();
    dropExport(s);
    expect(exportImported(s)).toBe(true);
    expect(s.messages).toHaveLength(5);
    expect(s.toCheck.some((t) => t.id === "t4")).toBe(true);
    expect(s.orders.find((o) => o.id === "o2")?.state).toBe("needs_check");
    dropExport(s);
    expect(s.messages).toHaveLength(5);
    expect(s.toCheck.filter((t) => t.id === "t4")).toHaveLength(1);
  });
});

describe("lists, aliases, replies, keys", () => {
  it("counts product rows less the header", () => {
    expect(skuRows("SKU,Name,Price\nA,a,1\n\nB,b,2\r\n")).toBe(2);
    expect(skuRows("")).toBe(1);
    const s = seed();
    setSkuList(s, 42);
    expect([s.settings.skuCount, s.settings.skuDate]).toEqual([42, "today"]);
  });

  it("approves a proposed alias as the person working, and logs it", () => {
    const s = seed();
    s.user = "u1";
    const p = s.aliases.find((a) => a.state === "proposed")!;
    aliasSet(s, p.text, "EGC-EFMX");
    aliasOk(s, p.text);
    expect(s.aliases.find((a) => a.text === p.text)).toMatchObject({ sku: "EGC-EFMX", state: "approved", by: "May" });
    expect(s.history.at(-1)).toMatchObject({ who: "May", kind: "alias_approved" });
    aliasNo(s, p.text);
    expect(s.aliases.some((a) => a.text === p.text)).toBe(false);
  });

  it("toggles one reply option and keeps the others", () => {
    const s = seed();
    toggleReply(s, "lines");
    expect(s.settings.reply).toEqual({ lines: false, date: true, sign: true });
    toggleReply(s, "lines");
    expect(s.settings.reply?.lines).toBe(true);
  });

  it("keeps only the masked key, and revokes it", () => {
    const s = seed();
    const raw = demoKey();
    expect(raw).toMatch(/^pot_[0-9a-f]{36}$/);
    createKey(s, "u3", raw);
    expect(s.keys).toEqual([{ id: "k101", label: "Dennis's key", who: "Account manager", masked: raw.slice(0, 8) + "…" + raw.slice(-4) }]);
    expect(JSON.stringify(s)).not.toContain(raw);
    revokeKey(s, "k101");
    expect(s.keys).toEqual([]);
  });
});
