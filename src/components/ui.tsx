"use client";

/* The shared components. Built once, used everywhere; styles in globals.css. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Pill as PillT } from "@/checker/present";
import { Icon } from "./icons";

export function Pill({ pill, className }: { pill: PillT; className?: string }) {
  const tone = pill.tone === "good" ? " ic-pill--good" : pill.tone === "warn" ? " ic-pill--warn" : "";
  return <span className={`ic-pill${tone}${className ? " " + className : ""}`}>{pill.text}</span>;
}

/** A count pill: amber when it needs the user, neutral otherwise, with a hidden noun for screen readers. */
export function Count({ n, warn, noun }: { n: number; warn?: boolean; noun?: string }) {
  return (
    <span className={warn ? "ic-pill ic-pill--warn" : "n"}>
      {n}
      {noun ? <span className="sr">{` ${noun}`}</span> : null}
    </span>
  );
}

export function Search({ label, placeholder, value, onChange, full }: { label: string; placeholder?: string; value: string; onChange: (v: string) => void; full?: boolean }) {
  return (
    <label className={`ic-search${full ? " ic-search--full" : ""}`}>
      <Icon name="search" size="ui" />
      <span className="sr">{label}</span>
      <input type="search" placeholder={placeholder ?? "Search"} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Notice({ tone, children, onDismiss }: { tone?: "warn"; children: ReactNode; onDismiss?: () => void }) {
  return (
    <div className={`ic-notice${tone === "warn" ? " ic-notice--warn" : ""}`} role={tone === "warn" ? "alert" : "status"}>
      {children}
      {onDismiss ? (
        <button type="button" className="ic-icobtn x" aria-label="Dismiss" onClick={onDismiss}>
          <Icon name="x" />
        </button>
      ) : null}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside `box`, closes on Esc, and gives focus back to what opened it. */
function useTrap(open: boolean, onClose: () => void) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      back?.focus?.();
    };
  }, [open]);
  return box;
}

export function Dialog({
  open,
  title,
  onClose,
  footer,
  size,
  drawer,
  sub,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  size?: "sm";
  drawer?: boolean;
  sub?: ReactNode;
  children: ReactNode;
}) {
  const box = useTrap(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <>
      <div className="ic-scrim" onClick={onClose} />
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={id} className={drawer ? "ic-drawer" : `ic-dialog${size === "sm" ? " ic-dialog--sm" : ""}`}>
        <div className="ic-dialog-h">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <h2 id={id}>{title}</h2>
            {sub ? <span className="muted">{sub}</span> : null}
          </div>
          <button type="button" className="ic-icobtn x" aria-label="Close" onClick={onClose}>
            <Icon name="x" size="ui" />
          </button>
        </div>
        <div className="ic-dialog-b">{children}</div>
        {footer ? <div className={`ic-dialog-f${drawer ? " split" : ""}`}>{footer}</div> : null}
      </div>
    </>
  );
}

export type DropState = { kind: "idle" } | { kind: "error"; title: string; reason: string };

/**
 * A file dropzone. Idle, dragging (accent border), and error (solid amber border, the reason, and
 * "Choose another file"). The checking state is the uploads card that replaces it.
 */
export function Dropzone({
  title,
  hint,
  accept,
  multiple,
  size = "lg",
  state = { kind: "idle" },
  onFiles,
  inputLabel,
}: {
  title: string;
  hint: string;
  accept?: string;
  multiple?: boolean;
  size?: "lg" | "md" | "sm";
  state?: DropState;
  onFiles: (files: File[]) => void;
  inputLabel: string;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = () => input.current?.click();
  const error = state.kind === "error";
  const cls = ["ic-drop", size === "lg" ? "ic-drop--lg" : size === "sm" ? "ic-drop--sm" : "", over ? "ic-drop--over" : "", error ? "ic-drop--error" : ""].filter(Boolean).join(" ");
  const choose = (
    <button type="button" className="ic-choose" onClick={pick}>
      {error ? "Choose another file" : multiple ? "Choose files" : "Choose a file"}
    </button>
  );
  return (
    <div
      className={cls}
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <Icon name={error ? "warn" : "upload"} />
      {size === "sm" ? (
        <span className="muted">
          {title} {choose}
        </span>
      ) : error ? (
        <>
          <h3>{state.title}</h3>
          <p className="muted" role="alert">
            {state.reason}
          </p>
          {choose}
        </>
      ) : (
        <>
          <h3>{title}</h3>
          <p className="muted">
            {hint} {choose}
          </p>
        </>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        aria-label={inputLabel}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Hidden file input behind a button, for "Upload" buttons. */
export function useFilePicker(accept: string, multiple: boolean, onFiles: (files: File[]) => void) {
  const input = useRef<HTMLInputElement>(null);
  const node = (
    <input
      ref={input}
      type="file"
      hidden
      accept={accept}
      multiple={multiple}
      aria-hidden="true"
      tabIndex={-1}
      onChange={(e) => {
        if (e.target.files?.length) onFiles(Array.from(e.target.files));
        e.target.value = "";
      }}
    />
  );
  return { open: () => input.current?.click(), node };
}

/** Save text as a file (CSV export). */
export function download(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
