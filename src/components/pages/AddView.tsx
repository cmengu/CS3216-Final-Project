"use client";

/*
 * Add orders, as the prototype draws it. Step 1 adds files (PDF, WhatsApp paste, mailbox),
 * Step 2 reads them in the browser with the importer, Step 3 is the review table. Rows are the
 * importer's; this page only shows them, takes the reviewer's choices and passes them back
 * through the importer's own functions.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Header } from "@/components/shell/Header";
import { useShell } from "@/components/shell/context";
import { buildPayload, copyTable, exportColumns, exportRows, pickSku, proposeAlias, sheetOf } from "@/lib/add-orders";
import { activeCols, COL_ID, COLS, colOn, LAYOUTS, QL, stClass, toggleCol } from "@/lib/columns";
import { addDays, fileSize, fmtDay, money, nowStr } from "@/lib/format";
import {
  cellText,
  EGC_OUTPUT_COLUMNS,
  egcFileName,
  groupPoSheets,
  setManualValue,
  validate,
  writeExcel,
  type EgcColumnId,
  type EgcOutputRow,
} from "@/lib/importer";
import { sampleFiles } from "@/lib/samples";
import { canEdit, canPrice } from "@/platform/access";
import { submitConfirm } from "@/platform/confirm";
import { GROUP_LOGIN, PRODUCTS, TODAY } from "@/sample";
import { PASTE_EXAMPLE } from "@/sample/mail";
import {
  addPaste,
  assignCustomer,
  clearQueue,
  editRow,
  processFiles,
  removeFile,
  retryFailed,
  stageFiles,
  startOver,
  useAddBatch,
} from "@/state/add-batch";
import { checkMail as markChecked, dropExport as importExport, exportImported, mailFlow } from "@/state/actions/settings";
import { meOf, update, useDemo } from "@/state/demo-store";
import { conn, mailboxFiles, mailboxOn, pasteOn } from "@/state/selectors/connections";
const colDef = (id: EgcColumnId) => EGC_OUTPUT_COLUMNS.find((c) => c.id === id)!;

export function AddView() {
  const s = useDemo();
  const u = meOf(s);
  const shell = useShell();
  const router = useRouter();
  const b = useAddBatch();
  const [colpop, setColpop] = useState(false);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState("");
  const [pcust, setPcust] = useState(Object.keys(s.customers)[0]);
  const [pdate, setPdate] = useState(addDays(TODAY, 4));
  const relRef = useRef<HTMLSpanElement>(null);
  // The tabs read the connections Settings › Connections writes.
  const mail = mailboxFiles(s);
  const cx = conn(s);
  const owner = u.role === "owner";
  const priced = canPrice(u);

  useEffect(() => {
    if (!colpop) return;
    const close = (e: MouseEvent) => {
      if (!relRef.current?.contains(e.target as Node)) setColpop(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [colpop]);

  // ⌘V with a PDF on the clipboard adds it, as a dropped file would.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      update((d) => void (d.src = "pdf"));
      void stageFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const q = b.files;
  const ready = q.filter((f) => f.st === "ready");
  const failed = q.filter((f) => f.st === "failed" || f.st === "unsupported");
  const done = q.filter((f) => f.st === "parsed" || f.st === "partial");
  const busy = q.some((f) => f.st === "processing" || f.st === "validating");
  const cols = activeCols(s.layout, s.cols);
  const names = cols.map((c) => c[0]);
  const setSrc = (src: typeof s.src) => update((d) => void (d.src = src));

  const rows = b.rows;
  const { blockers, warnings } = useMemo(() => validate(rows), [rows]);
  const sheets = useMemo(() => sheetOf(rows), [rows]);
  const red = blockers.length > 0;
  const pos = new Set(rows.map((r) => r.source.sourceId)).size;
  const priceNote = new Map(warnings.filter((w) => w.field === "price" && w.rowId).map((w) => [w.rowId!, w.message]));

  const addSample = async () => {
    const files = await sampleFiles();
    if (!files.length) return shell.toast("No sample POs yet");
    void stageFiles(files);
  };

  const addFromMail = async () => {
    const files = await sampleFiles(mail.filter((m) => !q.some((f) => f.name === m.file)).map((m) => m.file));
    if (!files.length) return shell.toast("No sample POs yet");
    update((d) => {
      d.mailbox = mail.filter((m) => !files.some((f) => f.name === m.file));
      d.src = "pdf";
    });
    void stageFiles(files);
  };

  const checkMail = () => {
    update((d) => markChecked(d, nowStr().slice(11)));
    shell.toast("Checked the mailbox");
  };

  const readOrder = async () => {
    const r = await addPaste(paste, pcust, s.customers[pcust]?.name ?? "", pdate || addDays(TODAY, 4));
    shell.toast(r.lines ? `${r.lines} lines read${r.unparsed ? `, ${r.unparsed} kept as notes` : ""}` : "No order lines found");
  };

  // The prototype's dropExport: a sample chat export links three messages and proposes one change.
  const dropExport = () => {
    if (exportImported(s)) return shell.toast("Already imported");
    update(importExport);
    shell.toast("41 messages read · 3 linked · 1 change to review");
  };

  const lineDesc = (r: EgcOutputRow) =>
    b.reads.find((x) => x.fileId === r.source.sourceId)?.order.lines.find((l) => l.lineNumber === r.source.lineNumber)?.description ?? r.cells.sku.sourceText ?? "";

  const pick = (r: EgcOutputRow, sku: string) => {
    const p = PRODUCTS[sku];
    if (!p) return;
    const desc = lineDesc(r);
    editRow(r.id, (x) => pickSku(x, p));
    update((d) => void (d.aliases = proposeAlias(d.aliases, desc, sku, r.cells.poNumber.value ?? "")));
    shell.toast(`“${desc}” → ${sku} · alias proposed`);
  };

  const copy = () => shell.copyText(copyTable(rows, names, priced), `Copied ${rows.length} rows`);

  const download = async () => {
    const blob = await writeExcel(exportRows(rows, priced), { columnOrder: exportColumns(names, priced) });
    const name = egcFileName(new Date());
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    const n = groupPoSheets(rows).length;
    shell.toast(`Downloaded ${name} · ${n} sheet${n === 1 ? "" : "s"}`);
  };

  const confirmAll = async () => {
    const payload = await buildPayload(b.reads, rows);
    const n = await submitConfirm(payload, Object.fromEntries(b.reads.map((r) => [r.fileName, r.size])));
    startOver();
    router.push("/orders");
    shell.toast(`${n} order${n === 1 ? "" : "s"} confirmed`);
  };

  const td = (cls: string, body: ReactNode, note?: ReactNode, key?: string) => (
    <td key={key} className={cls}>
      {body}
      {note ? <div className="note">{note}</div> : null}
    </td>
  );
  const cv = (text: string, mono = false) => <div className={mono ? "cv mono" : "cv"}>{text || "—"}</div>;

  const cellFor = (n: string, r: EgcOutputRow) => {
    const id = COL_ID[n];
    if (!id) return td("", cv(sheets.get(r.id) ?? "", true), null, n);
    const c = r.cells[id];
    const un = c.origin === "unresolved";
    if (id === "sku") {
      if (c.value) return td("", cv(String(c.value), true), null, n);
      return td(
        "flag",
        <select value="" onChange={(e) => e.target.value && pick(r, e.target.value)} aria-label="Pick SKU">
          <option value="">No match</option>
          {Object.values(PRODUCTS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} · {p.name}
            </option>
          ))}
        </select>,
        <>“{lineDesc(r)}” is not in the SKU list</>,
        n,
      );
    }
    if (id === "quantity") {
      const unit = c.sourceText ?? ""; // the unit as the PO prints it
      return td(
        c.value === null ? "flag" : "",
        <div className="cv">
          <input
            type="number"
            min={1}
            defaultValue={c.value ?? ""}
            style={{ width: 56, padding: "2px 6px", border: 0, background: "transparent", font: "inherit" }}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (v >= 1) editRow(r.id, (x) => setManualValue(x, "quantity", v));
            }}
            aria-label="Quantity"
          />{" "}
          {unit}
        </div>,
        null,
        n,
      );
    }
    if (id === "price" || id === "total") {
      const warn = id === "price" && priced ? priceNote.get(r.id) : undefined;
      return td(warn ? "flag" : "", <div className="cv">{priced ? (c.value !== null ? money(Number(c.value)) : "—") : "·"}</div>, warn, n);
    }
    if (id === "customer" && un) {
      return td(
        "flag",
        <select value="" onChange={(e) => e.target.value && assignCustomer(r.source.sourceId, e.target.value)} aria-label="Pick customer">
          <option value="">No match</option>
          {Object.values(s.customers).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>,
        <>“{c.sourceText ?? ""}” is not in the customer list</>,
        n,
      );
    }
    if (id === "session" && c.value === "Unspecified") return td("flag", cv("Unspecified"), "No time on the PO", n);
    if (id === "orderDate" && un) {
      return td(
        "flag",
        <div className="cv">
          <input type="date" style={{ padding: "2px 6px", border: 0, background: "transparent", font: "inherit" }} onChange={(e) => e.target.value && editRow(r.id, (x) => setManualValue(x, "orderDate", e.target.value))} aria-label="Order Date" />
        </div>,
        null,
        n,
      );
    }
    if (id === "poNumber" && un) {
      return td(
        "flag",
        <div className="cv">
          <input style={{ width: 110, padding: "2px 6px", border: 0, background: "transparent", font: "inherit" }} onBlur={(e) => e.target.value.trim() && editRow(r.id, (x) => setManualValue(x, "poNumber", e.target.value.trim()))} aria-label="PO Number" />
        </div>,
        null,
        n,
      );
    }
    const text = id === "dateConverted" ? (c.value ? fmtDay(String(c.value)) : "") : cellText(r, colDef(id));
    const mono = id === "customerId" || id === "poNumber";
    return td(un && id !== "salesNotes" ? "flag" : "", cv(text, mono), null, n);
  };

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
            <input
              type="file"
              accept="application/pdf"
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                void stageFiles(files);
              }}
            />
          </label>
        </div>
      </div>
      <div className="drop" tabIndex={0}>
        <b>Drop PDFs here</b>or paste an email attachment
      </div>
      {b.notice ? <div className="hint">{b.notice}</div> : null}
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
              {q.map((f) => (
                <li key={f.id}>
                  <span style={{ minWidth: 0 }}>
                    <div className="fn">{f.name}</div>
                    <div className="fs">
                      {fileSize(f.size)}
                      {f.detail && f.st !== "ready" ? " · " + f.detail : ""}
                    </div>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className={`st ${stClass(f.st)}`}>{QL[f.st]}</span>
                    <button className="rm" disabled={busy} onClick={() => removeFile(f.id)}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn p" disabled={busy || !ready.length} onClick={() => void processFiles()}>
              {busy ? "Processing…" : `Process ${ready.length} file${ready.length === 1 ? "" : "s"}`}
            </button>
            {failed.length ? (
              <button className="btn" onClick={() => void retryFailed()}>
                Retry {failed.length} failed file{failed.length === 1 ? "" : "s"}
              </button>
            ) : null}
            <button className="btn g" disabled={busy} onClick={clearQueue}>
              Clear queue
            </button>
          </div>
        </>
      ) : (
        <div className="hint" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          No files yet ·{" "}
          <button className="btn s g" style={{ display: "inline-flex", padding: "2px 6px" }} onClick={() => void addSample()}>
            use the four sample POs
          </button>
        </div>
      )}
    </>
  );

  const mailList = mail.length ? (
    <div className="q">
      <ul>
        {mail.map((x) => (
          <li key={x.file}>
            <span style={{ minWidth: 0 }}>
              <div className="fn">{x.file}</div>
              <div className="fs">
                {x.from} · {x.subj} · {x.at}
              </div>
            </span>
            <span className="st">{fileSize(x.size)}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  const step1Mail = mailboxOn(s) && cx.mail ? (
    <>
      <div className="lead">
        <div>
          <div className="step">Step 1</div>
          <h2>{mail.length ? "New in the mailbox" : "Nothing new in the mailbox"}</h2>
        </div>
        {mail.length ? (
          <button className="btn p" onClick={() => void addFromMail()}>
            Add {mail.length} PDF{mail.length > 1 ? "s" : ""} to the queue
          </button>
        ) : (
          <button className="btn" onClick={checkMail}>
            Check now
          </button>
        )}
      </div>
      {mailList}
      <div className="hint">
        {GROUP_LOGIN} · {cx.mail.kind} · checked {cx.mail.at} · PDFs are read on this device
      </div>
    </>
  ) : (
    <div className="lead">
      <div>
        <div className="step">Step 1</div>
        <h2>The orders mailbox is not connected</h2>
      </div>
      {owner ? (
        <Link className="btn p" href="/settings/connections" onClick={() => update((d) => mailFlow(d, "pick"))}>
          Connect a mailbox
        </Link>
      ) : (
        <span className="hint">The owner connects it in Settings</span>
      )}
    </div>
  );

  const step1Wa = !pasteOn(s) ? (
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
    <>
      <div className="lead">
        <div>
          <div className="step">Step 1</div>
          <h2>Paste a WhatsApp order</h2>
        </div>
        <button className="btn g s" onClick={dropExport}>
          Import a chat export
        </button>
      </div>
      <textarea id="paste" style={{ minHeight: 84 }} placeholder={"18/9 Fri\nPea tendrils 4box\nRed veined sorrel-2\nEgyptian star flower red-1"} value={paste} onChange={(e) => setPaste(e.target.value)} />
      <div className="form">
        <label>
          Customer
          <select id="pcust" value={pcust} onChange={(e) => setPcust(e.target.value)}>
            {Object.values(s.customers).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Delivery date
          <input id="pdate" type="date" value={pdate} onChange={(e) => setPdate(e.target.value)} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn p" onClick={() => void readOrder()}>
          Read order
        </button>
        <button className="btn g" onClick={() => setPaste(PASTE_EXAMPLE)}>
          Example
        </button>
      </div>
    </>
  );

  return (
    <>
      <Header>Add orders</Header>
      <div className="body">
        <section
          className={over ? "stepc on" : "stepc"}
          id="dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const files = [...e.dataTransfer.files];
            if (!files.length) return;
            setSrc("pdf");
            void stageFiles(files);
          }}
        >
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
              <div style={{ marginTop: 2 }}>
                {rows.length ? `${rows.length} rows from ${pos} PO${pos === 1 ? "" : "s"}${red ? " · highlighted cells need a value" : ""}` : "No rows yet"}
              </div>
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
            {rows.length ? (
              <>
                <button className="btn p" disabled={red} onClick={copy}>
                  <Icon name="copy" />
                  Copy table
                </button>
                <button className="btn" disabled={red} onClick={() => void download()}>
                  <Icon name="dl" />
                  Download Excel
                </button>
                {s.settings.retainsRows && canEdit(u) ? (
                  <button className="btn" disabled={red} onClick={() => void confirmAll()}>
                    <Icon name="check" />
                    Confirm {pos} order{pos > 1 ? "s" : ""}
                  </button>
                ) : null}
              </>
            ) : null}
            <button className="btn g" onClick={startOver}>
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
                {rows.length ? (
                  rows.map((r) => <tr key={r.id}>{names.map((n) => cellFor(n, r))}</tr>)
                ) : (
                  <tr>
                    <td className="emptyc" colSpan={cols.length}>
                      Rows appear after processing
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
