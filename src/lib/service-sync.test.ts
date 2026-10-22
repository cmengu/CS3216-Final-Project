import { afterEach, expect, it, vi } from "vitest";
import { broadcastServiceChange, listenForServiceChanges } from "./service-sync";

afterEach(() => vi.unstubAllGlobals());

it("refreshes for visible focus and sibling-tab changes, then removes listeners", () => {
  const browser = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", document);
  const refresh = vi.fn();
  const stop = listenForServiceChanges("master", refresh);
  browser.dispatchEvent(new Event("focus"));
  browser.dispatchEvent(Object.assign(new Event("storage"), { key: "unrelated" }));
  expect(refresh).toHaveBeenCalledTimes(1);
  browser.dispatchEvent(Object.assign(new Event("storage"), { key: "master" }));
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  expect(refresh).toHaveBeenCalledTimes(2);
  document.visibilityState = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  expect(refresh).toHaveBeenCalledTimes(3);
  stop();
  browser.dispatchEvent(new Event("focus"));
  browser.dispatchEvent(Object.assign(new Event("storage"), { key: "master" }));
  expect(refresh).toHaveBeenCalledTimes(3);
});

it("broadcasts only a change token and tolerates blocked browser storage", () => {
  const setItem = vi.fn();
  vi.stubGlobal("window", { localStorage: { setItem } });
  broadcastServiceChange("master", "version-2");
  expect(setItem).toHaveBeenCalledWith("master", expect.stringContaining("version-2:"));
  setItem.mockImplementation(() => { throw new Error("blocked"); });
  expect(() => broadcastServiceChange("master", "version-3")).not.toThrow();
});
