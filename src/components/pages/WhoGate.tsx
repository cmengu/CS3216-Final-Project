"use client";

/*
 * "Who's working?" One tile per person; Owner and Finance confirm with a four-digit PIN
 * (demo: any four digits, as in the prototype). The pick is remembered for this browser session.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { needsPin } from "@/platform/access";
import { GROUP_LOGIN, ROLES } from "@/sample";
import { useDemo } from "@/state/demo-store";
import { pick, useMounted } from "@/state/session";
import { initials } from "@/lib/format";

export function WhoGate({ pinFor }: { pinFor?: string }) {
  const s = useDemo();
  const mounted = useMounted();
  const router = useRouter();
  const [pinId, setPinId] = useState<string | undefined>(pinFor);
  const pinRef = useRef<HTMLInputElement>(null);
  const p = pinId ? s.people.find((x) => x.id === pinId) : undefined;

  useEffect(() => {
    if (p) pinRef.current?.focus();
  }, [p]);

  const setWho = (id: string) => {
    pick(id);
    router.push("/home");
  };

  const askWho = (id: string) => {
    const x = s.people.find((y) => y.id === id);
    if (x && needsPin(x)) setPinId(id);
    else setWho(id);
  };

  return (
    <div className="gate" id="who">
      {mounted ? (
        <div className="whobox">
          <h2>{p ? `Hi ${p.name}` : "Who's working?"}</h2>
          <p>{p ? ROLES[p.role] : GROUP_LOGIN}</p>
          {p ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const el = pinRef.current;
                if (el && /^\d{4}$/.test(el.value)) setWho(p.id);
                else if (el) {
                  el.value = "";
                  el.focus();
                }
              }}
            >
              <input ref={pinRef} name="pin" type="password" inputMode="numeric" maxLength={4} autoComplete="off" placeholder="PIN" aria-label="PIN" />
              <div className="whoacts">
                <button
                  type="button"
                  className="btn g"
                  onClick={() => {
                    setPinId(undefined);
                    if (pinFor) router.replace("/who");
                  }}
                >
                  Back
                </button>
                <button className="btn p">Continue</button>
              </div>
            </form>
          ) : (
            <div className="whogrid">
              {s.people.map((x) => (
                <button key={x.id} onClick={() => askWho(x.id)}>
                  <span className="av">{initials(x.name)}</span>
                  <b>{x.name}</b>
                  <small>{ROLES[x.role] + (needsPin(x) ? " · PIN" : "")}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
