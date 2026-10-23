import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVICE_URL } from "./api";
import {
  disconnectOutlook,
  downloadOutlookAttachmentFile,
  fetchOutlookMessageDetail,
  fetchOutlookMessages,
  fetchOutlookStatus,
  outlookLoginUrl,
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
});
