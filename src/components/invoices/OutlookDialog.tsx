"use client";

import { useCallback, useEffect, useState } from "react";
import {
  disconnectOutlook,
  downloadOutlookAttachmentFile,
  fetchOutlookMessageDetail,
  fetchOutlookMessages,
  fetchOutlookStatus,
  outlookLoginUrl,
  type OutlookAttachmentSummary,
  type OutlookMessageDetail,
  type OutlookMessageSummary,
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
  const [error, setError] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Record<string, boolean>>({});
  const [importingId, setImportingId] = useState<string | null>(null);

  const loadMessages = useCallback(
    async (opts?: { onlyAtt?: boolean; q?: string }) => {
      setLoadingMessages(true);
      setError(null);
      const res = await fetchOutlookMessages({
        limit: 25,
        onlyAttachments: opts?.onlyAtt ?? onlyAttachments,
        search: opts?.q ?? search,
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
    [onlyAttachments, search]
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
  }, [open, onlyAttachments, search]);

  useEffect(() => {
    if (!open || !status?.connected || !selectedId) return;
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
  }, [open, status?.connected, selectedId]);

  const loadingStatus = open && status === null && error === null;
  const loadingDetail = Boolean(
    open && status?.connected && selectedId && (!detail || detail.id !== selectedId)
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

  const selectedSummary = messages.find((m) => m.id === selectedId) ?? null;
  const activeMessage = detail && detail.id === selectedId ? detail : selectedSummary;
  const pdfAttachments = detail?.attachments.filter((a) => a.isPdf) ?? [];

  return (
    <Dialog
      open={open}
      title="Microsoft Outlook"
      onClose={onClose}
      footer={
        <>
          {status?.connected ? (
            <button
              type="button"
              className="ic-btn ic-btn--ghost"
              onClick={handleDisconnect}
            >
              Disconnect account
            </button>
          ) : null}
          <button type="button" className="ic-btn ic-btn--secondary" onClick={onClose}>
            Close
          </button>
        </>
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
        <p className="muted" style={{ margin: 0 }}>
          Checking Outlook connection…
        </p>
      ) : !status?.connected ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <a
              className="ic-btn ic-btn--primary"
              href={outlookLoginUrl("/invoices")}
              aria-disabled={status ? !status.configured : false}
              style={
                status && !status.configured
                  ? { pointerEvents: "none", opacity: 0.5 }
                  : undefined
              }
            >
              <Icon name="mail" size="ui" />
              Connect Microsoft Outlook
            </a>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              paddingBottom: 10,
              borderBottom: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Pill pill={{ tone: "good", text: "Connected" }} />
              <span style={{ fontWeight: 600 }}>{status.displayName}</span>
              {status.email && status.email !== status.displayName ? (
                <span className="muted">({status.email})</span>
              ) : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadMessages({ q: search });
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <div style={{ flex: 1 }}>
              <Search
                label="Search subject, sender, or email content"
                value={search}
                onChange={setSearch}
                full
              />
            </div>
            <button
              type="submit"
              className="ic-btn ic-btn--secondary"
              disabled={loadingMessages}
            >
              Search
            </button>
          </form>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(240px, 290px) minmax(0, 1fr)",
              gap: 14,
              minHeight: 360,
              maxHeight: 460,
            }}
          >
            <div
              aria-label="Inbox messages"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                overflowY: "auto",
                paddingRight: 4,
                borderRight: "1px solid var(--line)",
              }}
            >
              {loadingMessages && messages.length === 0 ? (
                <p className="muted" style={{ margin: "12px 4px" }}>
                  Loading inbox…
                </p>
              ) : messages.length === 0 ? (
                <p className="muted" style={{ margin: "12px 4px" }}>
                  No matching emails found in your inbox.
                </p>
              ) : (
                messages.map((m) => {
                  const isCurrent = m.id === selectedId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className="ic-qcard"
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => setSelectedId(m.id)}
                      style={{ textAlign: "left", width: "100%", cursor: "pointer" }}
                    >
                      <span className="r1">
                        <b
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.senderName}
                        </b>
                        <span className="muted num" style={{ whiteSpace: "nowrap" }}>
                          {whenLabel(m.receivedAt)}
                        </span>
                      </span>
                      <span
                        className="r2"
                        style={{
                          fontWeight: 500,
                          color: "var(--ink)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.subject}
                      </span>
                      <span className="r3">
                        {m.hasAttachments ? (
                          <Pill pill={{ tone: "neutral", text: "Attachment" }} />
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>
                            No attachments
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div
              aria-label="Email content"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {!activeMessage ? (
                <p className="muted" style={{ margin: "12px 0" }}>
                  Select an email on the left to read its content and attachments.
                </p>
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      paddingBottom: 10,
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                        {activeMessage.subject}
                      </h3>
                      {activeMessage.webLink ? (
                        <a
                          href={activeMessage.webLink}
                          target="_blank"
                          rel="noreferrer"
                          className="ic-link"
                          style={{ whiteSpace: "nowrap", fontSize: 13 }}
                        >
                          Open in Outlook
                          <Icon name="external" />
                        </a>
                      ) : null}
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      From: <b style={{ color: "var(--ink)" }}>{activeMessage.senderName}</b>
                      {activeMessage.senderEmail
                        ? ` <${activeMessage.senderEmail}>`
                        : ""}{" "}
                      · {whenLabel(activeMessage.receivedAt)}
                    </div>
                  </div>

                  {loadingDetail ? (
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                      Loading attachments…
                    </p>
                  ) : detail && detail.attachments.length > 0 ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        padding: 12,
                        borderRadius: 8,
                        background: "var(--bg-subtle, rgba(0,0,0,0.03))",
                        border: "1px solid var(--line)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <strong style={{ fontSize: 13 }}>
                          Attachments ({detail.attachments.length})
                        </strong>
                        {pdfAttachments.length > 1 ? (
                          <button
                            type="button"
                            className="ic-btn ic-btn--primary ic-btn--sm"
                            disabled={importingId !== null}
                            onClick={async () => {
                              for (const att of pdfAttachments) {
                                await handleImportAttachment(detail.id, att);
                              }
                            }}
                          >
                            <Icon name="upload" size="ui" />
                            Import all PDFs ({pdfAttachments.length})
                          </button>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {detail.attachments.map((att) => {
                          const imported = Boolean(importedIds[att.id]);
                          const busy = importingId === att.id;
                          return (
                            <div
                              key={att.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 10,
                                padding: "6px 8px",
                                borderRadius: 6,
                                background: "var(--surface, #fff)",
                                border: "1px solid var(--line)",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  minWidth: 0,
                                }}
                              >
                                <Icon name="doc" size="ui" />
                                <span
                                  style={{
                                    fontWeight: 500,
                                    fontSize: 13,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {att.name}
                                </span>
                                <span className="muted" style={{ fontSize: 12 }}>
                                  {formatBytes(att.size)}
                                </span>
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
                                  onClick={() => void handleImportAttachment(detail.id, att)}
                                >
                                  <Icon name={imported ? "check" : "upload"} size="ui" />
                                  {busy
                                    ? "Importing…"
                                    : imported
                                    ? "Imported to queue"
                                    : "Import & check PDF"}
                                </button>
                              ) : (
                                <span className="muted" style={{ fontSize: 12 }}>
                                  Non-PDF
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--surface, #fff)",
                      whiteSpace: "pre-wrap",
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      flex: 1,
                      overflowY: "auto",
                    }}
                  >
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
