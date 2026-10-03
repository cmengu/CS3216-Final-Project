# PO Tracker

The context app for PO Tracker. Demo on sample data only: never commit a real purchase order, even redacted.

The approved design is the Version 16 prototype (`egc-platform-prd/prototype.html`). Where this app and the prototype differ, the prototype wins.

## Run

```
npm install
npm run dev          # http://localhost:3000, opens on "Who's working?"
npm test             # vitest (role helpers)
npm run lint
npm run typecheck
npm run build
```

Screenshots of the prototype and the app side by side, both themes (needs Google Chrome):

```
PROTO=/path/to/prototype.html APP=http://localhost:3000 OUT=/tmp/shots npm run shots
```

## Where things are

- `src/app/` routes: `/who`, and inside the `(shell)` group `/home`, `/orders`, `/orders/[id]`, `/add`, `/customers`, `/customers/[id]`, `/invoices`, `/people`, `/history`, `/settings/[pane]`. `/` goes to `/home`.
- `src/app/globals.css` the design system, ported from the prototype's CSS.
- `src/sample/` the invented products, customers, people, orders and events. One place, so a database seed can be generated from it.
- `src/platform/access.ts` the role helpers (`canPrice`, `canEdit`, `canDeliver`, `canInvoice`, `isOwner`, `visibleOrders`, `lines`). Pure for now; the server takes them over later.
- `src/state/` client demo state: the store (one localStorage key, "Reset demo data"), the picked person (per browser session) and the theme.
- `src/components/shell/` rail, profile menu, header, keyboard bar, ⌘K palette, ⌘I assistant column.

Purchase orders (`*.pdf`) and spreadsheets (`*.xlsx`) are ignored everywhere except under `fixtures/`, which may hold invented look-alikes only.
