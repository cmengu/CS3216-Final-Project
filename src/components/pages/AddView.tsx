"use client";

/*
 * Add orders: the static layout from the prototype. Three sources, Step 1 (add), Step 2 (the file
 * list, shown once files are queued), Step 3 (toolbar and the 14-column table). Reading PDFs and
 * WhatsApp text arrives with the importer library in the next task; nothing here touches a file.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { activeCols, COLS, colOn, LAYOUTS, QL, stClass, toggleCol } from "@/lib/columns";
import { fileSize } from "@/lib/format";
import { mailbox } from "@/platform/nav";
import { GROUP_LOGIN } from "@/sample";
import { meOf, update, useDemo } from "@/state/demo-store";

export function AddView() {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const [colpop, setColpop] = useState(false);
  const relRef = useRef<HTMLSpanElement>(null);
  const mail = mailbox(s);
  const owner = u.role === "owner";

  useEffect(() => {
    if (!colpop) return;
    const close = (e: MouseEvent) => {
      if (!relRef.current?.contains(e.target as Node)) setColpop(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [colpop]);

  const q = s.queue;
  const ready = q.filter((f) => f.st === "ready");
  const failed = q.filter((f) => f.st === "failed" || f.st === "unsupported");
  const done = q.filter((f) => f.st === "parsed" || f.st === "partial");
  const busy = q.some((f) => f.st === "processing" || f.st === "validating");
  const cols = activeCols(s.layout, s.cols);
  const setSrc = (src: typeof s.src) => update((d) => void (d.src = src));

  const step1Pdf = (
    <>
      <div className="lead">
        <div>
          <div className="step">Step 1</div>
          <h2>Add purchase order PDFs</h2>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => shell.toast("Press ⌘V with a PDF on the clipboard")}>
            Paste PDF
          </button>
          <label className="btn p" style={{ cursor: "pointer" }}>
            Choose PDF files
            <input type="file" accept="application/pdf" multiple hidden />
          </label>
        </div>
      </div>
      <div className="drop" tabIndex={0}>
        <b>Drop PDFs here</b>or paste an email attachment
      </div>
      {q.length ? (
        <>
          <div className="lead" style={{ marginTop: 6 }}>
            <div>
              <div className="step">Step 2</div>
              <h2 style={{ fontSize: 15 }}>Check your files</h2>
            </div>
            <span className="hint">
              {busy ? "Working…" : ready.length ? `${ready.length} queued` : done.length && done.length + failed.length === q.length ? `${done.length} of ${q.length} read` : ""}
            </span>
          </div>
          <div className="q">
            <ul>
              {q.map((f, i) => (
                <li key={f.name}>
                  <span style={{ minWidth: 0 }}>
                    <div className="fn">{f.name}</div>
                    <div className="fs">
                      {fileSize(f.size)}
                      {f.detail && f.st !== "ready" ? " · " + f.detail : ""}
                    </div>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className={`st ${stClass(f.st)}`}>{QL[f.st]}</span>
                    <button className="rm" disabled={busy} onClick={() => update((d) => void d.queue.splice(i, 1))}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn p" disabled={busy || !ready.length}>
              {busy ? "Processing…" : `Process ${ready.length} file${ready.length === 1 ? "" : "s"}`}
            </button>
            {failed.length ? (
              <button className="btn">
                Retry {failed.length} failed file{failed.length === 1 ? "" : "s"}
              </button>
            ) : null}
            <button className="btn g" disabled={busy} onClick={() => update((d) => void (d.queue = []))}>
              Clear queue
            </button>
          </div>
        </>
      ) : (
        <div className="hint" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          No files yet ·{" "}
          <button className="btn s g" style={{ display: "inline-flex", padding: "2px 6px" }}>
            use the four sample POs
          </button>
        </div>
      )}
    </>
  );

  const step1Mail = s.cx.mail ? (
    <>
      <div className="lead">
        <div>
          <div className="step">Step 1</div>
          <h2>{mail.length ? "New in the mailbox" : "Nothing new in the mailbox"}</h2>
        </div>
        {mail.length ? (
          <button className="btn p">
            Add {mail.length} PDF{mail.length > 1 ? "s" : ""} to the queue
          </button>
        ) : (
          <button className="btn">Check now</button>
        )}
      </div>
      <div className="hint">
        {GROUP_LOGIN} · {s.cx.mail.kind} · checked {s.cx.mail.at} · PDFs are read on this device
      </div>
    </>
  ) : (
    <div className="lead">
      <div>
        <div className="step">Step 1</div>
        <h2>The orders mailbox is not connected</h2>
      </div>
      {owner ? (
        <Link className="btn p" href="/settings/connections">
          Connect a mailbox
        </Link>
      ) : (
        <span className="hint">The owner connects it in Settings</span>
      )}
    </div>
  );

  const step1Wa = !s.cx.paste ? (
    <div className="lead">
      <div>
        <div className="step">Step 1</div>
        <h2>WhatsApp orders are turned off</h2>
      </div>
      {owner ? (
        <Link className="btn p" href="/settings/connections">
          Turn on in Settings
        </Link>
      ) : (
        <span className="hint">The owner turns this on in Settings</span>
      )}
    </div>
  ) : (
    <div className="lead">
      <div>
        <div className="step">Step 1</div>
        <h2>Paste a WhatsApp order</h2>
      </div>
    </div>
  );

  return (
    <>
      <Header>Add orders</Header>
      <div className="body">
        <section className="stepc" id="dropzone">
          <div className="src">
            <button className={s.src === "pdf" ? "on" : ""} onClick={() => setSrc("pdf")}>
              PDF purchase orders
            </button>
            <button className={s.src === "wa" ? "on" : ""} onClick={() => setSrc("wa")}>
              WhatsApp order
            </button>
            <button className={s.src === "mail" ? "on" : ""} onClick={() => setSrc("mail")}>
              Mailbox{mail.length ? <span className="cnt">{mail.length}</span> : null}
            </button>
          </div>
          {s.src === "pdf" ? step1Pdf : s.src === "mail" ? step1Mail : step1Wa}
        </section>

        <section className="scroll" style={{ padding: 0 }}>
          <div className="toolbar">
            <div>
              <div className="step">Step 3</div>
              <div style={{ marginTop: 2 }}>No rows yet</div>
            </div>
            <span className="sp" />
            <label className="lay">
              Layout
              <select value={s.layout} onChange={(e) => update((d) => void (d.layout = e.target.value as typeof d.layout))}>
                {Object.entries(LAYOUTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <span className="rel" ref={relRef}>
              <button className="btn" onClick={() => setColpop(!colpop)}>
                <Icon name="cols" />
                Customise layout
              </button>
              {colpop ? (
                <div className="popc">
                  {COLS.map(([n, bg]) => (
                    <label key={n}>
                      <input type="checkbox" checked={colOn(s.cols, n)} onChange={(e) => update((d) => void (d.cols = toggleCol(d.cols, n, e.target.checked)))} />
                      <span className="sw" style={{ background: bg }} />
                      {n}
                    </label>
                  ))}
                  <button className="btn s g" style={{ marginTop: 4 }} onClick={() => update((d) => void (d.cols = null))}>
                    Reset
                  </button>
                </div>
              ) : null}
            </span>
            <button className="btn g" onClick={() => update((d) => void (d.queue = []))}>
              Start over
            </button>
          </div>
          <div className="grid14" style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  {cols.map(([n, bg]) => (
                    <th key={n} style={{ background: bg }}>
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="emptyc" colSpan={cols.length}>
                    Rows appear after processing
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
