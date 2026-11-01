import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVICE_URL } from "./api";
import {
  disconnectOutlook,
  downloadOutlookAttachmentFile,
  fetchOutlookMessageDetail,
  fetchOutlookMessages,
  fetchOutlookStatus,
  outlookLoginUrl,
  scanOutlookMessages,
} from "./outlook";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("outlook client", () => {
  it("uses port 8001 by default for SERVICE_URL and outlookLoginUrl", () => {
    expect(SERVICE_URL).toBe("http://127.0.0.1:8001");
    expect(outlookLoginUrl("/invoices")).toBe(
      "http://127.0.0.1:8001/auth/outlook/login?return_to=%2Finvoices"
    );
  });

  it("fetches connection status and inbox messages", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/outlook/status")) {
        return new Response(
          JSON.stringify({
            configured: true,
            connected: true,
            email: "billing@outlook.com",
            displayName: "Billing Team",
            connectedAt: "2026-10-23T10:00:00Z",
            redirectUri: "http://localhost:8001/auth/outlook/callback",
          }),
          { status: 200 }
        );
      }
      if (url.includes("/outlook/messages?")) {
        return new Response(
          JSON.stringify({
            messages: [
              {
                id: "msg-101",
                subject: "October Invoice",
                senderName: "Supplier Co",
                senderEmail: "ar@supplier.example",
                receivedAt: "2026-10-23T09:00:00Z",
                bodyPreview: "Attached is your invoice.",
                bodyText: "Hello,\nAttached is your invoice for October.",
                hasAttachments: true,
                webLink: null,
              },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await fetchOutlookStatus();
    expect(status).toEqual({
      ok: true,
      value: {
        configured: true,
        connected: true,
        email: "billing@outlook.com",
        displayName: "Billing Team",
        connectedAt: "2026-10-23T10:00:00Z",
        redirectUri: "http://localhost:8001/auth/outlook/callback",
      },
    });

    const msgs = await fetchOutlookMessages({
      limit: 15,
      onlyAttachments: true,
      search: "October",
    });
    expect(msgs.ok).toBe(true);
    if (msgs.ok) {
      expect(msgs.value).toHaveLength(1);
      expect(msgs.value[0].bodyText).toContain("Attached is your invoice for October.");
    }
  });

  it("fetches message details and downloads PDF attachments as File objects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/outlook/messages/msg-101")) {
          return new Response(
            JSON.stringify({
              id: "msg-101",
              subject: "October Invoice",
              senderName: "Supplier Co",
              senderEmail: "ar@supplier.example",
              receivedAt: "2026-10-23T09:00:00Z",
              bodyPreview: "Attached",
              bodyText: "Full body text",
              hasAttachments: true,
              attachments: [
                {
                  id: "att-1",
                  name: "INV-101.pdf",
                  contentType: "application/pdf",
                  size: 1024,
                  isPdf: true,
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/outlook/messages/msg-101/attachments/att-1/file")) {
          return new Response(new Uint8Array([37, 80, 68, 70]), {
            status: 200,
            headers: { "Content-Type": "application/pdf" },
          });
        }
        if (url.endsWith("/outlook/disconnect")) {
          return new Response(
            JSON.stringify({
              configured: true,
              connected: false,
              email: null,
              displayName: null,
              connectedAt: null,
              redirectUri: "http://localhost:8001/auth/outlook/callback",
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      })
    );

    const detail = await fetchOutlookMessageDetail("msg-101");
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.value.attachments[0].isPdf).toBe(true);
      const fileRes = await downloadOutlookAttachmentFile(
        "msg-101",
        detail.value.attachments[0]
      );
      expect(fileRes.ok).toBe(true);
      if (fileRes.ok) {
        expect(fileRes.value.name).toBe("INV-101.pdf");
        expect(fileRes.value.type).toBe("application/pdf");
      }
    }

    const disc = await disconnectOutlook();
    expect(disc.ok).toBe(true);
    if (disc.ok) {
      expect(disc.value.connected).toBe(false);
    }
  });

  it("filters messages by date range and runs AI email scan", async () => {
    const seenUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        seenUrls.push(url);
        if (url.includes("/outlook/messages?")) {
          return new Response(JSON.stringify({ messages: [] }), { status: 200 });
        }
        if (url.endsWith("/outlook/scan") && init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          expect(body).toEqual({
            dateFrom: "2026-10-01",
            dateTo: "2026-10-24",
            limit: 25,
          });
          return new Response(
            JSON.stringify({
              scannedCount: 2,
              invoiceEmailCount: 1,
              invoiceAttachmentCount: 1,
              model: "gpt-5.4-mini",
              items: [
                {
                  message: {
                    id: "msg-201",
                    subject: "Invoice #INV-201",
                    senderName: "Fresh Produce Co",
                    senderEmail: "billing@fresh.example",
                    receivedAt: "2026-10-20T09:00:00Z",
                    bodyPreview: "Attached invoice",
                    bodyText: "Attached is Invoice #INV-201",
                    hasAttachments: true,
                    attachments: [
                      {
                        id: "att-201",
                        name: "INV-201.pdf",
                        contentType: "application/pdf",
                        size: 4096,
                        isPdf: true,
                      },
                    ],
                  },
                  isInvoiceEmail: true,
                  confidence: "high",
                  supplierName: "Fresh Produce Co",
                  reasoning: "Email contains supplier invoice PDF.",
                  invoiceAttachments: [
                    {
                      id: "att-201",
                      name: "INV-201.pdf",
                      contentType: "application/pdf",
                      size: 4096,
                      isPdf: true,
                    },
                  ],
                },
              ],
            }),
            { status: 200 }
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      })
    );

    const listRes = await fetchOutlookMessages({
      dateFrom: "2026-10-01",
      dateTo: "2026-10-24",
    });
    expect(listRes.ok).toBe(true);
    expect(seenUrls[0]).toContain("date_from=2026-10-01");
    expect(seenUrls[0]).toContain("date_to=2026-10-24");

    const scanRes = await scanOutlookMessages({
      dateFrom: "2026-10-01",
      dateTo: "2026-10-24",
      limit: 25,
    });
    expect(scanRes.ok).toBe(true);
    if (scanRes.ok) {
      expect(scanRes.value.invoiceEmailCount).toBe(1);
      expect(scanRes.value.invoiceAttachmentCount).toBe(1);
      expect(scanRes.value.items[0].supplierName).toBe("Fresh Produce Co");
    }
  });
});


it("protects Outlook scan and disconnect with the browser request header", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.credentials).toBe("include");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "X-Requested-With": "InvoiceChecker" });
    return Response.json({ configured: true, connected: false, messages: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  expect((await disconnectOutlook()).ok).toBe(true);
  expect((await scanOutlookMessages()).ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
