# PO Tracker

The context app for PO Tracker. Demo on sample data only: never commit a real purchase order, even redacted.

The approved design is the Version 16 prototype (`egc-platform-prd/prototype.html`). Where this app and the prototype differ, the prototype wins.

## Run

```
npm install
npm run dev          # http://localhost:3000, opens on "Who's working?"
npm test             # vitest (role helpers, Add orders logic, the importer's sample POs)
npm run lint
npm run typecheck
npm run build
```

Screenshots of the prototype and the app side by side, both themes (needs Google Chrome):

```
PROTO=/path/to/prototype.html APP=http://localhost:3000 OUT=/tmp/shots npm run shots
```

End-to-end check of Add orders against a running app (needs Google Chrome):

```
APP=http://localhost:3000 OUT=/tmp/add-shots [PROTO=/path/to/prototype.html] npm run e2e
```

## Where things are

- `src/app/` routes: `/who`, and inside the `(shell)` group `/home`, `/orders`, `/orders/[id]`, `/add`, `/customers`, `/customers/[id]`, `/invoices`, `/people`, `/history`, `/settings/[pane]`. `/` goes to `/home`.
- `src/app/globals.css` the design system, ported from the prototype's CSS.
- `src/sample/` the invented products, customers, people, orders and events. One place, so a database seed can be generated from it.
- `src/lib/importer.ts` the one door to the importer library (`po-importer`); everything that reads, maps, checks or writes rows comes through it. `src/lib/add-orders.ts` and `src/state/add-batch.ts` are the app's side of Add orders; `src/platform/confirm.ts` holds `submitConfirm`.
- `src/sample/lists.ts` the importer's lists (SKU List, Customer Database, approved aliases) built from the sample data.
- `public/samples/` (git-ignored) the importer's look-alike sample POs, copied from the package by `scripts/copy-samples.mjs` before dev and build.
- `src/platform/access.ts` the role helpers (`canPrice`, `canEdit`, `canDeliver`, `canInvoice`, `isOwner`, `visibleOrders`, `lines`). Pure for now; the server takes them over later.
- `src/state/` client demo state: the store (one localStorage key, "Reset demo data"), the picked person (per browser session) and the theme.
- `src/components/shell/` rail, profile menu, header, keyboard bar, ⌘K palette, ⌘I assistant column.

Purchase orders (`*.pdf`) and spreadsheets (`*.xlsx`) are ignored everywhere except under `fixtures/`, which may hold invented look-alikes only.
