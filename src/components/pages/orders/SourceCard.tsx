"use client";

import { Fragment } from "react";
import { Icon } from "@/components/icons";
import type { Customer, Order } from "@/sample";
import { sourceRows } from "./logic";

/** Where the order came from: file, layout, read time, fingerprint. */
export function SourceCard({ o, c }: { o: Order; c: Customer }) {
  return (
    <>
      <div className="psec">
        <div className="ph2">
          Source <Icon name="chev" />
        </div>
        <div className="kv">
          {sourceRows(o, c).map(([k, v]) => (
            <Fragment key={k}>
              <span>{k}</span>
              <span className={k === "Fingerprint" || k === "File" ? "mono" : ""} style={{ wordBreak: "break-all" }}>
                {v}
              </span>
            </Fragment>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          PDF read in the browser · not stored
        </div>
      </div>
      <div style={{ height: 16 }} />
    </>
  );
}
