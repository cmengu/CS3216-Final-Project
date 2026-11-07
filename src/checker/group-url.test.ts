import { describe, expect, it } from "vitest";
import { findGroup, groupUrl } from "./group-url";
import type { Project } from "./projects";

const projects = [{ id: "a", name: "Site A & B" }, { id: "b", name: "Other" }, { id: "c", name: "Other" }] as Project[];

describe("group URLs", () => {
  it("encodes names and resolves the same group on either tab", () => {
    for (const path of ["/invoices", "/master-list"]) {
      const url = new URL(groupUrl(path, projects[0]), "http://localhost");
      expect(url.searchParams.get("group")).toBe("Site A & B");
      expect(findGroup(projects, url.searchParams)).toBe(projects[0]);
    }
  });
  it("accepts name-only and legacy ID links", () => {
    expect(findGroup(projects, new URLSearchParams({ group: "Site A & B" }))).toBe(projects[0]);
    expect(findGroup(projects, new URLSearchParams({ project: "b" }))).toBe(projects[1]);
  });
  it("uses the name over a conflicting ID and distinguishes duplicate names", () => {
    expect(findGroup(projects, new URLSearchParams({ group: "Other", project: "a" }))).toBe(projects[1]);
    expect(findGroup(projects, new URLSearchParams({ group: "Other", project: "c" }))).toBe(projects[2]);
    expect(findGroup(projects, new URLSearchParams({ group: "Missing", project: "a" }))).toBeUndefined();
  });
});
