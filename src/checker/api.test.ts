import { afterEach, describe, expect, it, vi } from "vitest";
import { listInvoices, uploadFailure, uploadInvoice, uploadProblem } from "./api";
import type { ServiceInvoice } from "./convert";

const id = "11111111-1111-1111-1111-111111111111";

function saved(supplier: string, total: string | null): ServiceInvoice {
  return {
    id,
    filename: "invoice-02.pdf",
    status: "completed",
    mode: "fixture",
    created_at: "2026-10-11T05:00:00+00:00",
    price_sheet_version: "sheet",
    error: null,
    invoice: {
      supplier_name: supplier,
      invoice_number: "DEMO-002",
      invoice_date: "2026-10-02",
      currency: "SGD",
      subtotal: "492.00",
      tax: "44.28",
      invoice_total: "536.28",
      lines: [],
    },
    check: { overcharge_total: total, lines: [], warnings: [] },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listInvoices", () => {
  it("reads each summary in full, because a summary has no supplier or overcharge", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/invoices?")) return new Response(JSON.stringify([{ id }]), { status: 200 });
      return new Response(JSON.stringify(saved("Invented Silicon Trading", "15.00")), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const list = await listInvoices();
    expect(list.map((invoice) => invoice.supplier)).toEqual(["Invented Silicon Trading"]);
    expect(list[0].overchargeTotal).toBe(15);
    expect(list[0].fixture).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says the service could not be reached and does not invent invoices", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    await expect(listInvoices()).rejects.toThrow("The checking service could not be reached.");
  });

  it("says the service had a problem when it answers with an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(listInvoices()).rejects.toThrow("The checking service had a problem.");
  });

  it("asks for every page, so invoices past the first hundred are not dropped", async () => {
    const page = Array.from({ length: 100 }, () => ({ id }));
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!url.includes("/invoices?")) return new Response(JSON.stringify(saved("Invented Silicon Trading", "15.00")), { status: 200 });
      asked.push(url.split("?")[1]);
      return new Response(JSON.stringify(url.endsWith("offset=0") ? page : [{ id }]), { status: 200 });
    }));
    expect(await listInvoices()).toHaveLength(101);
    expect(asked).toEqual(["limit=100&offset=0", "limit=100&offset=100"]);
  });
});

describe("uploadProblem", () => {
  it("refuses a file that is not a PDF, or is too large, before anything is sent", () => {
    expect(uploadProblem({ name: "prices.xlsx", size: 10 })).toBe("Only PDF files can be checked.");
    expect(uploadProblem({ name: "big.PDF", size: 20 * 1024 * 1024 + 1 })).toBe("That PDF is over the 20 MB limit.");
    expect(uploadProblem({ name: "invoice.PDF", size: 20 * 1024 * 1024 })).toBeNull();
  });
});

describe("uploadInvoice", () => {
  it("names the three refusals in one sentence each", () => {
    expect(uploadFailure(429)).toBe("Another invoice is being checked. Try again in a moment.");
    expect(uploadFailure(503)).toBe("The checking service is not ready.");
    expect(uploadFailure(422)).toBe("This invoice could not be checked.");
    expect(uploadFailure(201)).toBeNull();
  });

  it("passes on the service's own reason for refusing a file", () => {
    expect(uploadFailure(422, "PDF must contain 1–30 pages")).toBe("This file could not be checked. PDF must contain 1–30 pages");
    expect(uploadFailure(415, "Upload a PDF")).toBe("This file could not be checked. Upload a PDF");
    expect(uploadFailure(413)).toBe("That PDF is over the 20 MB limit.");
    expect(uploadFailure(500)).toBe("The checking service had a problem. Try again in a moment.");
  });

  it("returns an invoice the service kept but could not check, so its page can say why", async () => {
    const failed = { ...saved("Invented Silicon Trading", null), status: "failed", error: "reading: No readable text or tables", check: null };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(failed), { status: 422 })));
    const invoice = await uploadInvoice(new File(["%PDF"], "blank.pdf", { type: "application/pdf" }));
    expect(invoice.state).toBe("failed");
    expect(invoice.error).toBe("reading: No readable text or tables");
  });

  it("shows the service's sentence when it refused the file and kept nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Encrypted PDFs are not supported" }), { status: 422 })));
    await expect(uploadInvoice(new File(["%PDF"], "locked.pdf", { type: "application/pdf" }))).rejects.toThrow(
      "This file could not be checked. Encrypted PDFs are not supported",
    );
  });

  it("returns the saved invoice after a 201", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(saved("Invented Silicon Trading", "15.00")), { status: 201 })));
    const invoice = await uploadInvoice(new File(["%PDF"], "invoice-02.pdf", { type: "application/pdf" }));
    expect(invoice.number).toBe("DEMO-002");
    expect(invoice.overchargeTotal).toBe(15);
  });

  it("does not return an invoice the service could not check", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 422 })));
    await expect(uploadInvoice(new File(["%PDF"], "invoice-02.pdf", { type: "application/pdf" }))).rejects.toThrow(
      "This invoice could not be checked.",
    );
  });
});
