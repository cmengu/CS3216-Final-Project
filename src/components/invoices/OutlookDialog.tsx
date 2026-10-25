"use client";

import { useCallback, useEffect, useState } from "react";
import {
  disconnectOutlook,
  downloadOutlookAttachmentFile,
  fetchOutlookMessageDetail,
  fetchOutlookMessages,
  fetchOutlookStatus,
  outlookLoginUrl,
  scanOutlookMessages,
  type OutlookAttachmentSummary,
  type OutlookMessageDetail,
  type OutlookMessageSummary,
  type OutlookScannedEmail,
  type OutlookStatus,
} from "@/checker/outlook";
import { whenLabel } from "@/checker/present";
import { Icon } from "@/components/icons";
import { Dialog, Notice, Pill, Search } from "@/components/ui";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function OutlookDialog({
  open,
  onClose,
  onImportFiles,
  initialNotice,
  onClearInitialNotice,
}: {
  open: boolean;
  onClose: () => void;
  onImportFiles: (files: File[]) => void;
  initialNotice?: { tone?: "warn"; text: string } | null;
  onClearInitialNotice?: () => void;
}) {
  const [status, setStatus] = useState<OutlookStatus | null>(null);
  const [messages, setMessages] = useState<OutlookMessageSummary[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OutlookMessageDetail | null>(null);
  const [onlyAttachments, setOnlyAttachments] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [scanning, setScanning] = useState<"idle" | "classifying" | "extracting">("idle");
  const [scanSummary, setScanSummary] = useState<{
    scannedCount: number;
    invoiceEmailCount: number;
    queuedFileCount: number;
    model: string;
  } | null>(null);
  const [scannedById, setScannedById] = useState<Record<string, OutlookScannedEmail>>({});
  const [error, setError] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Record<string, boolean>>({});
  const [importingId, setImportingId] = useState<string | null>(null);

  const loadMessages = useCallback(
    async (opts?: {
      onlyAtt?: boolean;
      q?: string;
      from?: string;
      to?: string;
    }) => {
      setLoadingMessages(true);
      setError(null);
      const res = await fetchOutlookMessages({
        limit: 25,
        onlyAttachments: opts?.onlyAtt ?? onlyAttachments,
        search: opts?.q ?? search,
        dateFrom: opts?.from ?? dateFrom,
        dateTo: opts?.to ?? dateTo,
      });
      setLoadingMessages(false);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMessages(res.value);
      setSelectedId((prev) => {
        if (prev && res.value.some((m) => m.id === prev)) return prev;
        return res.value[0]?.id ?? null;
      });
    },
    [onlyAttachments, search, dateFrom, dateTo]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchOutlookStatus().then(async (st) => {
      if (cancelled) return;
      if (!st.ok) {
        setError(st.message);
        return;
      }
      setStatus(st.value);
      if (!st.value.connected) {
        setMessages([]);
        setSelectedId(null);
        setDetail(null);
        return;
      }
      const res = await fetchOutlookMessages({
        limit: 25,
        onlyAttachments,
        search,
        dateFrom,
        dateTo,
      });
      if (cancelled) return;
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMessages(res.value);
      setSelectedId((prev) => {
        if (prev && res.value.some((m) => m.id === prev)) return prev;
        return res.value[0]?.id ?? null;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, onlyAttachments, search, dateFrom, dateTo]);

  useEffect(() => {
    if (!open || !status?.connected || !selectedId) return;
    const cachedScan = scannedById[selectedId];
    if (cachedScan) {
      return;
    }
    let cancelled = false;
    fetchOutlookMessageDetail(selectedId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setDetail(res.value);
      } else {
        setError(res.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, status?.connected, selectedId, scannedById]);

  const loadingStatus = open && status === null && error === null;
  const activeScanItem = selectedId ? scannedById[selectedId] ?? null : null;
  const resolvedDetail =
    activeScanItem?.message ?? (detail && detail.id === selectedId ? detail : null);
  const loadingDetail = Boolean(
    open && status?.connected && selectedId && !resolvedDetail
  );

  const handleDisconnect = async () => {
    setError(null);
    const res = await disconnectOutlook();
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setStatus(res.value);
    setMessages([]);
    setSelectedId(null);
    setDetail(null);
    setScannedById({});
    setScanSummary(null);
  };

  const handleImportAttachment = async (
    messageId: string,
    att: OutlookAttachmentSummary
  ) => {
    setImportingId(att.id);
    setError(null);
    const res = await downloadOutlookAttachmentFile(messageId, att);
    setImportingId(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onImportFiles([res.value]);
    setImportedIds((prev) => ({ ...prev, [att.id]: true }));
  };

  const handleAiScanAndExtract = async () => {
    setError(null);
    setScanSummary(null);
    setScanning("classifying");

    const scanRes = await scanOutlookMessages({
      dateFrom,
      dateTo,
      limit: 25,
    });

    if (!scanRes.ok) {
      setScanning("idle");
      setError(scanRes.message);
      return;
    }

    const scanData = scanRes.value;
    const nextScannedById: Record<string, OutlookScannedEmail> = {};
    for (const item of scanData.items) {
      nextScannedById[item.message.id] = item;
    }
    setScannedById(nextScannedById);
    setMessages(scanData.items.map((item) => item.message));

    const firstInvoiceMsg = scanData.items.find((item) => item.isInvoiceEmail)?.message;
    const nextSelected = firstInvoiceMsg?.id ?? scanData.items[0]?.message.id ?? null;
    setSelectedId(nextSelected);
    if (nextSelected && nextScannedById[nextSelected]) {
      setDetail(nextScannedById[nextSelected].message);
    }

    setScanning("extracting");
    const downloadedFiles: File[] = [];
    const newlyImported: Record<string, boolean> = {};

    for (const item of scanData.items) {
      if (!item.isInvoiceEmail || item.invoiceAttachments.length === 0) continue;
      for (const att of item.invoiceAttachments) {
        const dl = await downloadOutlookAttachmentFile(item.message.id, att);
        if (dl.ok) {
          downloadedFiles.push(dl.value);
          newlyImported[att.id] = true;
        } else {
          setError(dl.message);
        }
      }
    }

    if (downloadedFiles.length > 0) {
      onImportFiles(downloadedFiles);
      setImportedIds((prev) => ({ ...prev, ...newlyImported }));
    }

    setScanSummary({
      scannedCount: scanData.scannedCount,
      invoiceEmailCount: scanData.invoiceEmailCount,
      queuedFileCount: downloadedFiles.length,
      model: scanData.model,
    });
    setScanning("idle");
  };

  const selectedSummary = messages.find((m) => m.id === selectedId) ?? null;
  const activeMessage = resolvedDetail ?? selectedSummary;
  const pdfAttachments = resolvedDetail?.attachments.filter((a) => a.isPdf) ?? [];
  const aiMatchedAttIds = new Set(
    activeScanItem?.invoiceAttachments.map((a) => a.id) ?? []
  );

  return (
    <Dialog
      open={open}
      size="lg"
      title="Microsoft Outlook"
      onClose={onClose}
      footer={
        <div className="ic-outlook-footer">
          {status?.connected ? (
            <span className="muted num">
              Showing {messages.length} email(s) in chronological order
              {scanSummary
                ? ` · ${scanSummary.queuedFileCount} invoice PDF(s) queued for extraction`
                : ""}
            </span>
          ) : (
            <span />
          )}
          <button type="button" className="ic-btn ic-btn--secondary" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {initialNotice ? (
        <Notice tone={initialNotice.tone} onDismiss={onClearInitialNotice}>
          {initialNotice.text}
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="warn" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      ) : null}

      {loadingStatus && !status ? (
        <p className="ic-empty">Checking Outlook connection…</p>
      ) : !status?.connected ? (
        <div className="ic-outlook-connect">
          <p>
            Connect your Microsoft Outlook or Microsoft 365 inbox to read supplier emails
            and import PDF invoice attachments directly into the checking queue.
          </p>
          {status && !status.configured ? (
            <Notice tone="warn">
              <span>
                Microsoft OAuth is not configured on the backend yet. Add{" "}
                <code>MICROSOFT_CLIENT_ID</code>, <code>MICROSOFT_CLIENT_SECRET</code>, and{" "}
                <code>MICROSOFT_REDIRECT_URI={status.redirectUri}</code> to{" "}
                <code>backend/.env</code> and restart the backend server.
              </span>
            </Notice>
          ) : null}
          <div>
            <a
              className="ic-btn ic-btn--primary"
              href={outlookLoginUrl("/invoices")}
              aria-disabled={status ? !status.configured : false}
            >
              <Icon name="mail" size="ui" />
              Connect Microsoft Outlook
            </a>
          </div>
        </div>
      ) : (
        <div className="ic-outlook">
          <div className="ic-outlook-acct">
            <div className="ic-outlook-who">
              <Pill pill={{ tone: "good", text: "Connected" }} />
              <b>{status.displayName}</b>
              {status.email && status.email !== status.displayName ? (
                <span className="muted">({status.email})</span>
              ) : null}
            </div>
            <button
              type="button"
              className="ic-btn ic-btn--ghost ic-btn--sm"
              onClick={handleDisconnect}
            >
              Disconnect account
            </button>
          </div>

          <div className="ic-outlook-scanbar" aria-label="Date range and AI invoice scan">
            <div className="ic-outlook-dates">
              <label className="ic-outlook-datefield">
                <span>From date</span>
                <input
                  type="date"
                  aria-label="From date"
                  className="ic-input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </label>
              <label className="ic-outlook-datefield">
                <span>To date</span>
                <input
                  type="date"
                  aria-label="To date"
                  className="ic-input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </label>
              {dateFrom || dateTo ? (
                <button
                  type="button"
                  className="ic-btn ic-btn--ghost ic-btn--sm"
                  disabled={loadingMessages || scanning !== "idle"}
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                    setScannedById({});
                    setScanSummary(null);
                  }}
                >
                  Clear dates
                </button>
              ) : null}
            </div>

            <button
              type="button"
              className="ic-btn ic-btn--primary"
              disabled={scanning !== "idle" || loadingMessages}
              onClick={() => void handleAiScanAndExtract()}
            >
              <Icon name="spark" size="ui" />
              {scanning === "classifying"
                ? "AI reading & classifying emails…"
                : scanning === "extracting"
                ? "Fetching invoice PDFs & queuing extraction…"
                : "AI Scan & Extract Invoices"}
            </button>
          </div>

          {scanning !== "idle" ? (
            <div className="ic-outlook-step" role="status" aria-live="polite">
              <div className="ic-outlook-step-row">
                <span>
                  {scanning === "classifying"
                    ? `Step 1 of 2: AI reading emails${
                        dateFrom || dateTo
                          ? ` (${dateFrom || "any"} to ${dateTo || "any"})`
                          : ""
                      } & classifying supplier invoices…`
                    : "Step 2 of 2: Downloading matched invoice PDFs & queuing extraction…"}
                </span>
                <Pill pill={{ tone: "warn", text: "Running" }} />
              </div>
              <div className="ic-progress ic-progress--full">
                <span />
              </div>
            </div>
          ) : null}

          {scanSummary ? (
            <Notice
              tone={scanSummary.queuedFileCount > 0 ? undefined : "warn"}
              onDismiss={() => setScanSummary(null)}
            >
              <span>
                <b>AI Email Triage ({scanSummary.model}):</b> Read{" "}
                <b className="num">{scanSummary.scannedCount}</b> email(s)
                {dateFrom || dateTo
                  ? ` in range ${dateFrom || "any"} to ${dateTo || "any"}`
                  : ""}
                , classified <b className="num">{scanSummary.invoiceEmailCount}</b> as
                supplier invoice email(s), and automatically sent{" "}
                <b className="num">{scanSummary.queuedFileCount}</b> invoice PDF(s) to the
                extraction & price checking queue.
              </span>
              {scanSummary.queuedFileCount > 0 ? (
                <button
                  type="button"
                  className="ic-btn ic-btn--secondary ic-btn--sm"
                  onClick={onClose}
                >
                  View queue
                  <Icon name="arrowR" arrow />
                </button>
              ) : null}
            </Notice>
          ) : null}

          <div className="ic-outlook-toolbar">
            <form
              className="ic-outlook-searchform"
              onSubmit={(e) => {
                e.preventDefault();
                void loadMessages({ q: search });
              }}
            >
              <Search
                label="Search subject, sender, or email content"
                placeholder="Search subject, sender, or email content"
                value={search}
                onChange={setSearch}
                full
              />
              <button
                type="submit"
                className="ic-btn ic-btn--secondary ic-btn--sm"
                disabled={loadingMessages}
              >
                Search
              </button>
            </form>

            <div className="ic-controls">
              <div className="ic-seg" role="group" aria-label="Filter emails">
                <button
                  type="button"
                  aria-pressed={!onlyAttachments}
                  onClick={() => {
                    setOnlyAttachments(false);
                    void loadMessages({ onlyAtt: false });
                  }}
                >
                  All emails
                </button>
                <button
                  type="button"
                  aria-pressed={onlyAttachments}
                  onClick={() => {
                    setOnlyAttachments(true);
                    void loadMessages({ onlyAtt: true });
                  }}
                >
                  With attachments
                </button>
              </div>
              <button
                type="button"
                className="ic-btn ic-btn--secondary ic-btn--sm"
                disabled={loadingMessages}
                onClick={() => void loadMessages()}
              >
                {loadingMessages ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          <div className="ic-outlook-split">
            <div className="ic-outlook-list" aria-label="Inbox messages">
              {loadingMessages && messages.length === 0 ? (
                <p className="ic-empty">Loading inbox…</p>
              ) : messages.length === 0 ? (
                <p className="ic-empty">No matching emails found in your inbox.</p>
              ) : (
                messages.map((m) => {
                  const isCurrent = m.id === selectedId;
                  const scanned = scannedById[m.id];
                  const queuedFromScan = Boolean(
                    scanned?.isInvoiceEmail &&
                      scanned.invoiceAttachments.some((a) => importedIds[a.id])
                  );
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className="ic-qcard ic-outlook-card"
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => setSelectedId(m.id)}
                    >
                      <span className="r1">
                        <b>{m.senderName}</b>
                        <span className="muted num">{whenLabel(m.receivedAt)}</span>
                      </span>
                      <span className="r2">{m.subject}</span>
                      <span className="r3">
                        {scanned ? (
                          scanned.isInvoiceEmail ? (
                            <>
                              <Pill
                                pill={{
                                  tone: "good",
                                  text:
                                    scanned.invoiceAttachments.length > 0
                                      ? `Invoice (${scanned.invoiceAttachments.length} PDF)`
                                      : "Invoice email",
                                }}
                              />
                              {queuedFromScan ? (
                                <span className="ic-outlook-queued">
                                  <Icon name="check" />
                                  Queued
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <Pill pill={{ tone: "neutral", text: "Not an invoice" }} />
                          )
                        ) : m.hasAttachments ? (
                          <Pill pill={{ tone: "neutral", text: "Attachment" }} />
                        ) : (
                          <span className="muted">No attachments</span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="ic-outlook-detail" aria-label="Email content">
              {!activeMessage ? (
                <p className="ic-empty">
                  Select an email on the left to read its content and attachments.
                </p>
              ) : (
                <>
                  <div className="ic-outlook-head">
                    <div className="ic-outlook-head-top">
                      <h3>{activeMessage.subject}</h3>
                      {activeMessage.webLink ? (
                        <a
                          href={activeMessage.webLink}
                          target="_blank"
                          rel="noreferrer"
                          className="ic-link ic-link--sm"
                        >
                          Open in Outlook
                          <Icon name="external" />
                        </a>
                      ) : null}
                    </div>
                    <div className="muted">
                      From: <b>{activeMessage.senderName}</b>
                      {activeMessage.senderEmail ? ` <${activeMessage.senderEmail}>` : ""} ·{" "}
                      {whenLabel(activeMessage.receivedAt)}
                    </div>
                  </div>

                  {activeScanItem ? (
                    <div className="ic-outlook-box" aria-label="AI classification">
                      <div className="ic-outlook-box-h">
                        <div className="ic-outlook-box-title">
                          <Icon name="spark" size="ui" />
                          <strong>AI Classification:</strong>
                          <Pill
                            pill={{
                              tone: activeScanItem.isInvoiceEmail ? "good" : "neutral",
                              text: activeScanItem.isInvoiceEmail
                                ? "Invoice Email"
                                : "Not an Invoice",
                            }}
                          />
                          {activeScanItem.supplierName ? (
                            <span className="muted">
                              Supplier: <b>{activeScanItem.supplierName}</b>
                            </span>
                          ) : null}
                        </div>
                        <span className="muted">Confidence: {activeScanItem.confidence}</span>
                      </div>
                      <p>{activeScanItem.reasoning}</p>
                    </div>
                  ) : null}

                  {loadingDetail ? (
                    <p className="muted">Loading attachments…</p>
                  ) : resolvedDetail && resolvedDetail.attachments.length > 0 ? (
                    <div className="ic-outlook-box">
                      <div className="ic-outlook-box-h">
                        <strong className="num">
                          Attachments ({resolvedDetail.attachments.length})
                        </strong>
                        {pdfAttachments.length > 1 ? (
                          <button
                            type="button"
                            className="ic-btn ic-btn--primary ic-btn--sm"
                            disabled={importingId !== null}
                            onClick={async () => {
                              for (const att of pdfAttachments) {
                                await handleImportAttachment(resolvedDetail.id, att);
                              }
                            }}
                          >
                            <Icon name="upload" size="ui" />
                            Import all PDFs ({pdfAttachments.length})
                          </button>
                        ) : null}
                      </div>
                      <div className="ic-outlook-attlist">
                        {resolvedDetail.attachments.map((att) => {
                          const imported = Boolean(importedIds[att.id]);
                          const busy = importingId === att.id;
                          const isAiSelected = aiMatchedAttIds.has(att.id);
                          return (
                            <div key={att.id} className="ic-outlook-att">
                              <div className="ic-outlook-att-meta">
                                <Icon name="doc" size="ui" />
                                <span className="ic-outlook-att-name">{att.name}</span>
                                <span className="muted num">{formatBytes(att.size)}</span>
                                {isAiSelected ? (
                                  <Pill pill={{ tone: "good", text: "AI selected" }} />
                                ) : null}
                              </div>
                              {att.isPdf ? (
                                <button
                                  type="button"
                                  className={
                                    imported
                                      ? "ic-btn ic-btn--secondary ic-btn--sm"
                                      : "ic-btn ic-btn--primary ic-btn--sm"
                                  }
                                  disabled={busy}
                                  onClick={() =>
                                    void handleImportAttachment(resolvedDetail.id, att)
                                  }
                                >
                                  <Icon name={imported ? "check" : "upload"} size="ui" />
                                  {busy
                                    ? "Importing…"
                                    : imported
                                    ? "Queued for checking"
                                    : "Import PDF"}
                                </button>
                              ) : (
                                <span className="muted">Non-PDF</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="ic-outlook-body">
                    {activeMessage.bodyText || "(No email text content)"}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
