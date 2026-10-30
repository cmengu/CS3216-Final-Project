import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideInvoice,
  decisionFailure,
  getInvoice,
  invoiceFileUrl,
  listInvoices,
  retryInvoice,
  setActiveSessionId,
  uploadFailure,
  uploadInvoice,
  uploadInvoiceBatch,
  uploadProblem,
} from "./api";
import { toSupplierInvoice, type ServiceInvoice } from "./convert";

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
  it("keeps failed processing attempts from the service", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("/invoices?") ? [{ id }] : { ...saved("Unread supplier", null), status: "failed", check: null, error: "reading: No readable text" },
    ), { status: 200 })));
    const list = await listInvoices();
    expect(list).toHaveLength(1);
    expect(list[0].state).toBe("failed");
  });

  it("keeps an empty service list empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    expect(await listInvoices()).toEqual([]);
  });
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
  it("refuses unsupported or oversized invoice files, before anything is sent", () => {
    expect(uploadProblem({ name: "prices.xlsx", size: 10 })).toBe("Only PDF or Vietnamese HDon XML invoices can be checked.");
    expect(uploadProblem({ name: "big.PDF", size: 20 * 1024 * 1024 + 1 })).toBe("That invoice is over the 20 MB limit.");
    expect(uploadProblem({ name: "invoice.PDF", size: 20 * 1024 * 1024 })).toBeNull();
    expect(uploadProblem({ name: "invoice.XML", size: 12 })).toBeNull();
  });
});

describe("uploadInvoice", () => {
  it("posts the PDF as multipart file to the invoice service", async () => {
    const file = new File(["%PDF"], "upload.pdf", { type: "application/pdf" });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify(saved("Supplier", "0.00")), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await uploadInvoice(file);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/invoices$/);
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("file")).toBe(file);
    expect(init?.headers).toEqual({ "X-Requested-With": "InvoiceChecker" });
  });
  it("names the three refusals in one sentence each", () => {
    expect(uploadFailure(429)).toBe("Another invoice is being checked. Try again in a moment.");
    expect(uploadFailure(503)).toBe("The checking service is not ready.");
    expect(uploadFailure(422)).toBe("This invoice could not be checked.");
    expect(uploadFailure(201)).toBeNull();
  });

  it("passes on the service's own reason for refusing a file", () => {
    expect(uploadFailure(422, "PDF must contain 1–30 pages")).toBe("This file could not be checked. PDF must contain 1–30 pages");
    expect(uploadFailure(415, "Upload a PDF")).toBe("This file could not be checked. Upload a PDF");
    expect(uploadFailure(413)).toBe("That invoice is over the 20 MB limit.");
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

describe("service invoice retrieval", () => {
  it("does not invent a demo record or call the service for a sample ID", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getInvoice("sample-invoice")).rejects.toThrow("No invoice with this link");
    await expect(decideInvoice("sample-invoice", "ready_to_pay")).rejects.toThrow("No invoice with this link");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries by fetching the original PDF and posting it as a new invoice", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
      url.endsWith("/file")
        ? new Response("%PDF-original", { status: 200, headers: { "Content-Type": "application/pdf" } })
        : new Response(JSON.stringify(saved("Supplier", "0.00")), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const invoice = toSupplierInvoice(saved("Supplier", "0.00"));
    await retryInvoice(invoice);
    expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`/invoices/${id}/file$`));
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/invoices$/);
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
    const file = (fetchMock.mock.calls[1][1]?.body as FormData).get("file") as File;
    expect(await file.text()).toBe("%PDF-original");
  });
});

describe("decideInvoice", () => {
  it("sends the outcome and reason, and returns the saved invoice", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ ...saved("Invented Silicon Trading", "15.00"), outcome: "ready_to_pay_anyway", outcome_reason: "Credit note agreed", decided_at: "2026-10-15T02:00:00+00:00" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const invoice = await decideInvoice(id, "ready_to_pay_anyway", "Credit note agreed");
    expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`/invoices/${id}/outcome$`));
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ outcome: "ready_to_pay_anyway", reason: "Credit note agreed" });
    expect(invoice.outcomeReason).toBe("Credit note agreed");
  });
  it("says why the service refused a decision", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Ready to pay anyway needs a short reason" }), { status: 422 })));
    await expect(decideInvoice(id, "ready_to_pay_anyway", null)).rejects.toThrow("Ready to pay anyway needs a short reason.");
  });
  it("tells a service from before outcomes apart from a missing invoice", () => {
    expect(decisionFailure(404, "Not Found")).toBe("The checking service cannot save decisions yet.");
    expect(decisionFailure(404, "Invoice not found")).toBe("No invoice with this link. It may have been removed.");
    expect(decisionFailure(409, "The invoice is still being checked; decide once the check has finished")).toBe(
      "The invoice is still being checked; decide once the check has finished.",
    );
    expect(decisionFailure(500)).toBe("The checking service had a problem. Try again in a moment.");
  });
});

describe("session isolation headers and URLs", () => {
  it("attaches X-Invoice-Session header and session_id query param when a session is active", async () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    vi.stubGlobal("window", { sessionStorage: storage, localStorage: storage });

    setActiveSessionId("sess-user-42");
    expect(invoiceFileUrl(id)).toMatch(new RegExp(`/invoices/${id}/file\\?session_id=sess-user-42$`));

    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify(saved("Supplier", "0.00")), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await uploadInvoice(new File(["%PDF"], "upload.pdf", { type: "application/pdf" }));
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ "X-Invoice-Session": "sess-user-42", "X-Requested-With": "InvoiceChecker" });

    setActiveSessionId(null);
    expect(invoiceFileUrl(id)).toMatch(new RegExp(`/invoices/${id}/file$`));
  });
});


it("uploads a complete batch once and treats queued receipts as unfinished invoices", async () => {
  const files = [new File(["pdf"], "one.pdf"), new File(["xml"], "two.xml")];
  const fetchMock = vi.fn(async () => Response.json({ id: "batch", invoices: [{ ...saved("Supplier", null), status: "queued", invoice: null, check: null }], duplicates: [] }, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  const receipt = await uploadInvoiceBatch(files);
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toMatch(/\/invoice-batches$/);
  expect((init.body as FormData).getAll("files")).toEqual(files);
  expect(init.credentials).toBe("include");
  expect(init.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
  expect(receipt.invoices[0]).toMatchObject({ state: "checking", queued: true, lines: [] });
});

it("reports batch limits without claiming that checking has started", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: "Daily checking allowance reached." }, { status: 429, headers: { "Retry-After": "60" } })));
  await expect(uploadInvoiceBatch([new File(["pdf"], "one.pdf")])).rejects.toMatchObject({ status: 429, retryAfter: 60, message: "Daily checking allowance reached." });
});
