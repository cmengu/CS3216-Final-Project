import { describe, expect, it } from "vitest";
import { seed } from "@/sample";
import { addPersonTo, nowStr } from "./people";

describe("addPersonTo", () => {
  it("adds the person to the picker with an invite and logs it", () => {
    const s = seed();
    s.user = "u1";
    const before = s.people.length;
    const r = addPersonTo(
      s,
      { name: " Ana ", email: "ana@ediblegardencity.example", role: "account_manager", customer: "C10243" },
      { at: "2026-10-01 12:00", code: "abc123" },
    );
    expect(r).toMatchObject({ ok: true, toast: "Invite sent to Ana" });
    expect(s.people).toHaveLength(before + 1);
    expect(s.people.at(-1)).toEqual({
      id: "u101",
      name: "Ana",
      role: "account_manager",
      email: "ana@ediblegardencity.example",
      customers: ["C10243"],
      invite: "pot.example/i/abc123",
    });
    expect(s.seq).toBe(101);
    expect(s.history.at(-1)).toEqual({ at: "2026-10-01 12:00", who: "May", kind: "role_changed", order: null, text: "Added Ana as Account manager" });
  });

  it("gives all customers when the form says All customers", () => {
    const s = seed();
    addPersonTo(s, { name: "Bo", email: "bo@x.example", role: "packing", customer: "all" });
    expect(s.people.at(-1)!.customers).toBe("all");
    expect(s.people.at(-1)!.invite).toMatch(/^pot\.example\/i\/[a-z0-9]{1,6}$/);
  });

  it("needs name and email, and changes nothing without them", () => {
    const s = seed();
    const copy = structuredClone(s);
    expect(addPersonTo(s, { name: "  ", email: "a@b.example", role: "owner", customer: "all" })).toEqual({ ok: false, toast: "Name and email required" });
    expect(addPersonTo(s, { name: "Cy", email: "", role: "owner", customer: "all" }).ok).toBe(false);
    expect(s).toEqual(copy);
  });
});

describe("nowStr", () => {
  it("is the demo day with the clock's time", () => {
    expect(nowStr(new Date(2030, 0, 5, 7, 3))).toBe("2026-10-01 07:03");
  });
});
