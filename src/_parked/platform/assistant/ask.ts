/*
 * The assistant's answer, ported from the prototype's ask(). It is not a language model: the
 * question is matched with a few patterns, one to three of the lookups in tools.ts run, and the
 * answer is the steps taken, the records found (its sources) and at most two short sentences.
 */
import { visibleOrders } from "@/platform/access";
import { TODAY } from "@/sample";
import type { DemoState, Order, Person } from "@/sample";
import { addDays, ref, relDay, STATE, custOf } from "@/lib/format";
import { tools, type FindParams } from "./tools";

export interface Step {
  label: string;
  tool: "find_orders" | "open_order" | "order_history";
  params: string;
  rows: string;
  ms: string;
}

export interface Source {
  id: string; // the order it links to
  text: string;
  meta: string;
}

export interface Answer {
  key: string;
  q: string;
  at: string; // HH:MM
  steps: Step[];
  records: Source[];
  prose: string;
  checked: string;
  total: string; // seconds, one decimal
  thumb: 0 | 1 | -1;
}

export interface AskOptions {
  /** The order the conversation is scoped to, if any. */
  orderId?: string | null;
  /** Answer key, "a" + the store's next seq. */
  key?: string;
  /** Time shown on the question, HH:MM. */
  at?: string;
  /** Milliseconds clock for the step timings; performance.now() by default. */
  clock?: () => number;
}

const title = (s: DemoState, o: Order) => `${custOf(s.customers, o.cust).name} · ${ref(o)}`;

export function ask(s: DemoState, me: Person, raw: string, opt: AskOptions = {}): Answer {
  const clock = opt.clock ?? (() => performance.now());
  const T = tools(s, me);
  const mine = visibleOrders(s.orders, me);
  const q = raw.trim().toLowerCase();
  const orderId = opt.orderId && mine.some((o) => o.id === opt.orderId) ? opt.orderId : null;
  const steps: Step[] = [];
  let records: Source[] = [];
  let prose = "";
  let checked = "";

  const custName = Object.values(s.customers)
    .find((c) => q.includes(c.name.toLowerCase().split(" ")[0]))
    ?.name.toLowerCase();
  const refs = s.orders.map(ref).filter((r) => q.includes(r.toLowerCase()));
  const wantsHistory = /chang|history|happen|since|catch me up/.test(q);
  const wantsOpen = /open|still|undeliver|outstanding|pending/.test(q);
  const wantsNeeds = /need|waiting|blocked|check|today\?/.test(q) && !/goes out|deliver/.test(q);
  const wantsDay = /today|friday|tomorrow|monday|goes out/.test(q) && !wantsNeeds;
  const t0 = clock();

  // The order whose history was asked for: the scoped one, a named one, or the customer's latest.
  const historyOf =
    wantsHistory && (orderId || custName || refs.length)
      ? orderId
        ? mine.find((x) => x.id === orderId)
        : refs.length
          ? mine.find((x) => ref(x) === refs[0])
          : T.find_orders({ customer: custName }).sort((a, b) => b.date.localeCompare(a.date))[0]
      : undefined;

  if (historyOf) {
    const o = historyOf;
    const ev = T.order_history({ id: o.id });
    steps.push({ label: `Read the history of ${ref(o)}`, tool: "order_history", params: `order: ${ref(o)}`, rows: `${ev.length} events`, ms: (clock() - t0).toFixed(1) });
    records = ev.slice(-4).map((e) => ({ id: o.id, text: `${e.actor} · ${e.text}`, meta: relDay(e.at.slice(0, 10)) + " " + e.at.slice(11) }));
    prose = ev.length ? `${ev.length} events on ${title(s, o)}. Last: ${ev[ev.length - 1].text.toLowerCase()}.` : "No events.";
    checked = `checked 1 order, ${ev.length} events`;
  } else {
    const p: FindParams = {};
    if (custName) p.customer = custName;
    if (refs.length) p.ids = refs;
    if (wantsOpen) p.state = "open";
    if (wantsNeeds) p.state = "needs";
    if (wantsDay) p.date = /friday|tomorrow/.test(q) ? addDays(TODAY, 1) : /monday/.test(q) ? addDays(TODAY, 4) : TODAY;
    if (!custName && !wantsOpen && !wantsDay && !wantsNeeds && !refs.length && orderId) {
      const o = mine.find((x) => x.id === orderId)!;
      p.customer = custOf(s.customers, o.cust).name.toLowerCase();
      p.state = "open";
    }
    const found = T.find_orders(p);
    steps.push({
      label: `Searched orders${p.customer ? " for " + p.customer : ""}${p.state === "needs" ? " needing a check" : ""}${p.date ? " on " + relDay(p.date).toLowerCase() : ""}`,
      tool: "find_orders",
      params:
        Object.entries(p)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ") || "all",
      rows: `${found.length} orders`,
      ms: (clock() - t0).toFixed(1),
    });
    if (found.length && found.length <= 3) {
      found.forEach((o) => {
        const t1 = clock();
        T.open_order({ id: o.id });
        steps.push({ label: `Opened ${ref(o)}`, tool: "open_order", params: `order: ${ref(o)}`, rows: `${o.lines.length} lines`, ms: (clock() - t1).toFixed(1) });
      });
    }
    const lines = found.reduce((a, o) => a + o.lines.length, 0);
    records = found.map((o) => ({ id: o.id, text: `${ref(o)} · ${custOf(s.customers, o.cust).name} · ${o.lines.length} lines`, meta: `${STATE[o.state][1]} · ${relDay(o.date)}` }));
    prose = found.length
      ? `${found.length} order${found.length > 1 ? "s" : ""}, ${lines} lines.${found.some((o) => o.state === "needs_check") ? " One has a revision waiting." : ""}${found.some((o) => o.state === "blocked") ? " One is blocked on a SKU." : ""}`
      : "Nothing matches.";
    checked = `checked ${found.length} orders, ${lines} lines`;
  }

  return {
    key: opt.key ?? "a0",
    q: raw.trim(),
    at: opt.at ?? "",
    steps,
    records,
    prose,
    checked,
    total: ((clock() - t0) / 1000 + 0.3).toFixed(1),
    thumb: 0,
  };
}

/** The four suggested questions on the empty state; the first follows the scoped order. */
export const suggestions = (scoped: Pick<Order, "po" | "date" | "cust"> | null): string[] => [
  scoped ? `What changed on ${ref(scoped)}?` : "What needs me today?",
  "What is still open for Marina Grand?",
  "What goes out tomorrow?",
  "Catch me up on Harbour Hotel",
];

/** What the bulk bar's Ask prefills for a set of orders, as the prototype does. */
export const summarisePrompt = (orders: Pick<Order, "po" | "date" | "cust">[]) => `Summarise ${orders.map(ref).join(", ")}`;
