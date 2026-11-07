// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MasterImport } from "./MasterImport";
import { previewMasterList, uploadMasterList } from "@/masterList";

vi.mock("@/masterList", () => ({
  previewMasterList: vi.fn(), uploadMasterList: vi.fn(), replaceMasterList: vi.fn(),
}));

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it.each(["ai", "manual"] as const)("shows exploration warnings before confirming a %s mapping", async mappingSource => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const note = "This looks like goods-receipt history. Confirm these rows contain the prices you intend to check against.";
  vi.mocked(previewMasterList).mockResolvedValue({
    sheets: [{ name: "Receipts", rows: [["Product", "Unit price"], ["Example", "10"]], header: 0, mapping: { name: 0, price: 1 }, mappingSource, note }],
    fields: ["name", "price"], required: ["name", "price"],
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(MasterImport, { onSaved: vi.fn() })));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["Product,Unit price\nExample,10"], "synthetic.csv", { type: "text/csv" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(previewMasterList).toHaveBeenCalledWith(file);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(note);
  expect(dialog.querySelector('[role="status"]')?.textContent).toBe(note);
  expect(uploadMasterList).not.toHaveBeenCalled();
});
