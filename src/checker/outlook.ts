"use client";

import { SERVICE_URL } from "./api";

export interface OutlookStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  displayName: string | null;
  connectedAt: string | null;
  redirectUri: string;
}

export interface OutlookAttachmentSummary {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isPdf: boolean;
}

export interface OutlookMessageSummary {
  id: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  receivedAt: string;
  bodyPreview: string;
  bodyText: string;
  hasAttachments: boolean;
  webLink?: string | null;
}

export interface OutlookMessageDetail extends OutlookMessageSummary {
  attachments: OutlookAttachmentSummary[];
}

export interface OutlookScannedEmail {
  message: OutlookMessageDetail;
  isInvoiceEmail: boolean;
  confidence: "high" | "medium" | "low";
  supplierName: string | null;
  reasoning: string;
  invoiceAttachments: OutlookAttachmentSummary[];
}

export interface OutlookScanResponse {
  scannedCount: number;
  invoiceEmailCount: number;
  invoiceAttachmentCount: number;
  model: string;
  items: OutlookScannedEmail[];
}

export type OutlookResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const UNREACHABLE_MSG = "The checking service could not be reached.";

async function parseErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body?.detail === "string" && body.detail.trim()) {
      return body.detail;
    }
  } catch {
    // ignore non-JSON body
  }
  return fallback;
}

export function outlookLoginUrl(returnTo = "/invoices"): string {
  const params = new URLSearchParams({ return_to: returnTo });
  return `${SERVICE_URL}/auth/outlook/login?${params.toString()}`;
}

export async function fetchOutlookStatus(): Promise<OutlookResult<OutlookStatus>> {
  try {
    const res = await fetch(`${SERVICE_URL}/outlook/status`, { cache: "no-store" });
    if (!res.ok) {
      return {
        ok: false,
        message: await parseErrorDetail(res, "Could not check Outlook connection status."),
      };
    }
    const data = (await res.json()) as OutlookStatus;
    return { ok: true, value: data };
  } catch {
    return { ok: false, message: UNREACHABLE_MSG };
  }
}

export async function disconnectOutlook(): Promise<OutlookResult<OutlookStatus>> {
  try {
    const res = await fetch(`${SERVICE_URL}/outlook/disconnect`, {
      method: "POST",
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        message: await parseErrorDetail(res, "Could not disconnect Outlook."),
      };
    }
    const data = (await res.json()) as OutlookStatus;
    return { ok: true, value: data };
  } catch {
    return { ok: false, message: UNREACHABLE_MSG };
  }
}

export async function fetchOutlookMessages(options?: {
  limit?: number;
  onlyAttachments?: boolean;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<OutlookResult<OutlookMessageSummary[]>> {
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit ?? 20));
  if (options?.onlyAttachments) {
    params.set("only_attachments", "true");
  }
  if (options?.search?.trim()) {
    params.set("search", options.search.trim());
  }
  if (options?.dateFrom?.trim()) {
    params.set("date_from", options.dateFrom.trim());
  }
  if (options?.dateTo?.trim()) {
    params.set("date_to", options.dateTo.trim());
  }

  try {
    const res = await fetch(`${SERVICE_URL}/outlook/messages?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        message: await parseErrorDetail(res, "Could not load Outlook inbox messages."),
      };
    }
    const body = (await res.json()) as { messages?: OutlookMessageSummary[] };
    return { ok: true, value: body.messages ?? [] };
  } catch {
    return { ok: false, message: UNREACHABLE_MSG };
  }
}

export async function scanOutlookMessages(options?: {
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): Promise<OutlookResult<OutlookScanResponse>> {
  const payload: Record<string, unknown> = {
    limit: options?.limit ?? 25,
  };
  if (options?.dateFrom?.trim()) {
    payload.dateFrom = options.dateFrom.trim();
  }
  if (options?.dateTo?.trim()) {
    payload.dateTo = options.dateTo.trim();
  }

  try {
    const res = await fetch(`${SERVICE_URL}/outlook/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        message: await parseErrorDetail(res, "AI email scan could not be completed."),
      };
    }
    const data = (await res.json()) as OutlookScanResponse;
    return { ok: true, value: data };
  } catch {
    return { ok: false, message: UNREACHABLE_MSG };
  }
}

export async function fetchOutlookMessageDetail(
  messageId: string
): Promise<OutlookResult<OutlookMessageDetail>> {
  try {
    const res = await fetch(
      `${SERVICE_URL}/outlook/messages/${encodeURIComponent(messageId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return {
        ok: false,
        message: await parseErrorDetail(res, "Could not load email details."),
      };
    }
    const data = (await res.json()) as OutlookMessageDetail;
    return { ok: true, value: data };
  } catch {
    return { ok: false, message: UNREACHABLE_MSG };
  }
}

export async function downloadOutlookAttachmentFile(
  messageId: string,
  attachment: OutlookAttachmentSummary
): Promise<OutlookResult<File>> {
  try {
    const url = `${SERVICE_URL}/outlook/messages/${encodeURIComponent(
      messageId
    )}/attachments/${encodeURIComponent(attachment.id)}/file`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return {
        ok: false,
        message: await parseErrorDetail(res, `Could not download "${attachment.name}".`),
      };
    }
    const blob = await res.blob();
    const filename = attachment.name.toLowerCase().endsWith(".pdf")
      ? attachment.name
      : `${attachment.name}.pdf`;
    const file = new File([blob], filename, { type: "application/pdf" });
    return { ok: true, value: file };
  } catch {
    return { ok: false, message: UNREACHABLE_MSG };
  }
}
