"use client";

/*
 * Settings › Connections (prototype: connView). One grouped list: orders mailbox, WhatsApp paste and
 * chat export, WhatsApp live. Every flow is a walk-through on demo state; nothing connects for real.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { useShell } from "@/components/shell/context";
import { GROUP_LOGIN } from "@/sample";
import { MAIL0 } from "@/sample/mail";
import { useDemo, update } from "@/state/demo-store";
import { checkMail, connectMail, disconnectMail, dropExport, exportImported, mailFlow, setWa, togglePaste } from "@/state/actions/settings";
import { conn, mailboxFiles } from "@/state/selectors/connections";
import { fileSize } from "@/lib/format";

type Row = "mail" | "paste" | "wa";

const Tgl = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
  <button className={`tgl ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={onClick} />
);

const Stat = ({ k, children }: { k: "" | "ok" | "wait"; children: ReactNode }) => (
  <span className={`stat ${k}`}>
    <i />
    {children}
  </span>
);

function Head({ tone, ic, name, sub, st, sw }: { tone: string; ic: IconName; name: string; sub: ReactNode; st: ReactNode; sw: ReactNode }) {
  return (
    <div className="conn">
      <span className={`ci ${tone}`}>
        <Icon name={ic} />
      </span>
      <span className="ct">
        <b>{name}</b>
        <small>{sub}</small>
      </span>
      <span className="ca">
        {st}
        {sw}
      </span>
    </div>
  );
}

const Steps = ({ n, of, children }: { n: number; of: number; children: ReactNode }) => (
  <div className="stepper">
    {Array.from({ length: of }, (_, i) => (
      <i key={i} className={i < n ? "on" : ""} />
    ))}
    <span>{children}</span>
  </div>
);

const Pl = ({ c, children }: { c: string; children: ReactNode }) => (
  <span className="pl" style={{ "--c": c } as CSSProperties}>
    {children}
  </span>
);

/** The prototype's sample code: a fixed pseudo-random 21x21 pattern with three finder squares. Not a real QR code. */
function QR() {
  let n = 7;
  const cells: ReactNode[] = [];
  for (let y = 0; y < 21; y++)
    for (let x = 0; x < 21; x++) {
      n = (n * 1103515245 + 12345) & 0x7fffffff;
      const fx = x < 7 || x > 13,
        fy = y < 7 || y > 13,
        fin = fx && fy && !(x > 13 && y > 13);
      const lx = x < 7 ? x : x - 14,
        ly = y < 7 ? y : y - 14;
      const on = fin
        ? lx === 0 || lx === 6 || ly === 0 || ly === 6 || (lx > 1 && lx < 5 && ly > 1 && ly < 5)
        : (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)
          ? false
          : (n >> 16) & 1;
      if (on) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
    }
  return (
    <svg className="qr" viewBox="-1 -1 23 23" fill="#111" aria-label="Sample code">
      {cells}
    </svg>
  );
}

export function ConnectionsPane() {
  const s = useDemo();
  const { toast } = useShell();
  // Which row's body slides in on this change (prototype: window._cxAnim).
  const [an, setAn] = useState<Row | null>(null);
  const c = conn(s),
    m = c.mail,
    f = c.mailFlow,
    ms = mailboxFiles(s),
    imported = exportImported(s);

  const act = (row: Row, fn: Parameters<typeof update>[0]) => {
    setAn(row);
    update(fn);
  };
  const body = (k: Row, step: string, html: ReactNode) =>
    html ? (
      <div key={`${k}-${step}`} className={`cbody ${an === k ? "in" : ""}`}>
        {html}
      </div>
    ) : null;

  const sample = () => {
    if (imported) return toast("Already imported");
    setAn(null);
    update(dropExport);
    toast("41 messages read · 3 linked · 1 change to review");
  };

  const mail = (
    <>
      <Head
        tone="t-info"
        ic="mail"
        name="Orders mailbox"
        sub={m ? `${GROUP_LOGIN} · ${m.kind}` : "Outlook or Gmail"}
        st={m ? <Stat k="ok">Connected · checked {m.at}</Stat> : f ? <Stat k="wait">Connecting</Stat> : <Stat k="">Not connected</Stat>}
        sw={
          <Tgl
            on={!!(m || f)}
            label="Orders mailbox"
            onClick={() => {
              if (m) {
                act("mail", disconnectMail);
                toast("Mailbox disconnected");
              } else act("mail", (d) => mailFlow(d, f ? null : "pick"));
            }}
          />
        }
      />
      {body(
        "mail",
        m ? "on" : (f ?? ""),
        m ? (
          <>
            <div className="kv">
              <span>Can</span>
              <span>Read mail and open PDF attachments</span>
              <span>Cannot</span>
              <span>Send, delete or move mail</span>
              <span>PDFs</span>
              <span>Opened on this device, never stored</span>
            </div>
            {ms.length ? (
              <div className="q">
                <ul>
                  {ms.map((x) => (
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
            ) : (
              <div className="hint">Nothing new in the mailbox.</div>
            )}
            <div className="cact">
              <button
                className="btn s"
                onClick={() => {
                  setAn(null);
                  update((d) => checkMail(d));
                  toast("Checked the mailbox");
                }}
              >
                Check now
              </button>
            </div>
          </>
        ) : f === "pick" ? (
          <>
            <Steps n={1} of={2}>
              Where is the orders mailbox?
            </Steps>
            <div className="prov">
              <button onClick={() => act("mail", (d) => mailFlow(d, "Outlook"))}>
                <Pl c="var(--info)">O</Pl>
                <span>
                  <b>Outlook</b>
                  <small>Microsoft 365</small>
                </span>
              </button>
              <button onClick={() => act("mail", (d) => mailFlow(d, "Gmail"))}>
                <Pl c="var(--bad)">G</Pl>
                <span>
                  <b>Gmail</b>
                  <small>Google Workspace</small>
                </span>
              </button>
            </div>
          </>
        ) : f ? (
          <>
            <Steps n={2} of={2}>
              Sign in to {f}
            </Steps>
            <div className="consent">
              <div className="acc">
                <span className="av">O</span>
                <span>
                  <b>Orders</b>
                  <small>{GROUP_LOGIN}</small>
                </span>
              </div>
              <div className="perm">
                <div className="pr2 ok">
                  <Icon name="check" />
                  Read mail in this mailbox
                </div>
                <div className="pr2 ok">
                  <Icon name="check" />
                  Open PDF attachments on this device
                </div>
                <div className="pr2 no">
                  <Icon name="x" />
                  Send, delete or move mail
                </div>
              </div>
              <div className="cact">
                <button className="btn s g" onClick={() => act("mail", (d) => mailFlow(d, "pick"))}>
                  Back
                </button>
                <button
                  className="btn s p"
                  onClick={() => {
                    act("mail", (d) => connectMail(d, f));
                    toast(`${f} connected · ${MAIL0.length} new PDFs`);
                  }}
                >
                  Allow
                </button>
              </div>
            </div>
          </>
        ) : null,
      )}
    </>
  );

  const paste = (
    <>
      <Head
        tone="t-good"
        ic="chat"
        name="WhatsApp paste and chat export"
        sub="Works from any phone, nothing to install"
        st={c.paste ? <Stat k="ok">On</Stat> : <Stat k="">Off</Stat>}
        sw={<Tgl on={c.paste} label="WhatsApp paste and chat export" onClick={() => act("paste", togglePaste)} />}
      />
      {body(
        "paste",
        "on",
        c.paste ? (
          <div className="how">
            <div>
              <h4>Import a chat export</h4>
              <ol>
                <li>In the chat: More, Export chat, Without media</li>
                <li>Add the .txt file here</li>
                <li>Messages attach to their orders</li>
              </ol>
              <div className="cact">
                <label className="btn s" style={{ cursor: "pointer" }}>
                  Choose file
                  <input type="file" accept=".txt,.zip" hidden onChange={sample} />
                </label>
                <button className="btn s" onClick={sample}>
                  Try a sample export
                </button>
              </div>
              {imported ? (
                <div className="hint" style={{ marginTop: 8 }}>
                  Last import · 41 messages read · 3 linked · 1 change to review
                </div>
              ) : null}
            </div>
          </div>
        ) : null,
      )}
    </>
  );

  const live = (
    <>
      <Head
        tone="t-good"
        ic="spark"
        name="WhatsApp, live on your number"
        sub="Messages arrive on their order by themselves"
        st={c.wa === "pending" ? <Stat k="wait">Waiting for Meta</Stat> : c.wa ? <Stat k="wait">Setting up</Stat> : <Stat k="">Off</Stat>}
        sw={<Tgl on={!!c.wa} label="WhatsApp live" onClick={() => act("wa", (d) => setWa(d, c.wa ? null : "ask"))} />}
      />
      {body(
        "wa",
        c.wa ?? "",
        c.wa === "ask" ? (
          <>
            <Steps n={1} of={3}>
              Which app receives the orders?
            </Steps>
            <div className="prov">
              <button onClick={() => act("wa", (d) => setWa(d, "qr"))}>
                <Pl c="var(--good)">B</Pl>
                <span>
                  <b>WhatsApp Business</b>
                  <small>Green icon with a B</small>
                </span>
              </button>
              <button onClick={() => act("wa", (d) => setWa(d, "no"))}>
                <Pl c="var(--ink3)">W</Pl>
                <span>
                  <b>Ordinary WhatsApp</b>
                  <small>Personal app</small>
                </span>
              </button>
            </div>
          </>
        ) : c.wa === "no" ? (
          <>
            <Steps n={1} of={3}>
              Move the number to WhatsApp Business first
            </Steps>
            <div className="hint">It is free. The number, chats and groups stay the same.</div>
            <div className="cact">
              <button className="btn s g" onClick={() => act("wa", (d) => setWa(d, "ask"))}>
                Back
              </button>
              <button className="btn s" onClick={() => act("wa", (d) => setWa(d, "qr"))}>
                Done, continue
              </button>
            </div>
          </>
        ) : c.wa === "qr" ? (
          <>
            <Steps n={2} of={3}>
              Link the phone that receives orders
            </Steps>
            <div className="qrrow">
              <QR />
              <ol>
                <li>Open WhatsApp Business on that phone</li>
                <li>Settings, then Linked devices</li>
                <li>Scan this code</li>
              </ol>
            </div>
            <div className="cact">
              <button className="btn s g" onClick={() => act("wa", (d) => setWa(d, "ask"))}>
                Back
              </button>
              <button
                className="btn s p"
                onClick={() => {
                  act("wa", (d) => setWa(d, "pending"));
                  toast("Number linked · sent to Meta for review");
                }}
              >
                I have scanned it
              </button>
            </div>
          </>
        ) : c.wa === "pending" ? (
          <>
            <Steps n={3} of={3}>
              Waiting for Meta to approve
            </Steps>
            <ul className="chk">
              <li className="ok">
                <Icon name="check" />
                Number linked
              </li>
              <li>
                <Icon name="clock" />
                Meta review
              </li>
              <li>
                <Icon name="clock" />
                Messages arrive on their order
              </li>
            </ul>
            <div className="hint">The phone keeps working as before. Group chats are not included.</div>
          </>
        ) : null,
      )}
    </>
  );

  return (
    <div className="clist">
      <div className="citem">{mail}</div>
      <div className="citem">{paste}</div>
      <div className="citem">{live}</div>
    </div>
  );
}
