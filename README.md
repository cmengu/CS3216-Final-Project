# PO Tracker

The context app for PO Tracker. Demo on sample data only: never commit a real purchase order, even redacted.

The approved design is the Version 16 prototype (`egc-platform-prd/prototype.html`). Where this app and the prototype differ, the prototype wins.

## Run the demo

1. Install once: `npm install`. The importer library comes from the private GitHub repo `neokh719/PO-Transformer-KH` (tag `v0.1.0`), so the machine needs read access to it.
2. Start it: `npm run dev`, then open http://localhost:3000. It opens on "Who's working?".
3. Pick **Eunice** (sales coordinator) for the main walk. She sees prices and can add and confirm orders. Pick **May** (owner) for People and Settings, **Farah** (finance) for Invoices, **Mei** (packing) or **Dennis** (account manager, two customers only) to show what other roles see.
4. The PIN: May and Farah are asked for one. Any four digits work (for example 1234); anything else is refused and the box clears.
5. The Add orders walk: Add orders → "use the four sample POs" → Process. Four POs are read and the slide deck is refused. One cell is highlighted ("Edible flower mix (tray)" has no SKU): pick a SKU in it. Then Copy table, Download Excel and Confirm 4 orders. The orders appear on Home and Orders; open one for its lines, the customer, the source file and the timeline.
6. WhatsApp: as May, Settings → Connections → turn on "WhatsApp paste and chat export" → Try an example → Read order.
7. "Reset demo data" in the profile menu (bottom left) puts everything back.

Where the sample POs come from: they are invented look-alikes that ship inside the importer package (`node_modules/po-importer/fixtures/egc/`). Before `dev` and `build`, `scripts/copy-samples.mjs` copies them into `public/samples/`, which git ignores. No real purchase order is in this repo.

## Checks

```
npm test             # vitest: role rules for all five people, Add orders logic, the importer's sample POs
npm run lint
npm run typecheck
npm run build
```

Against a running app (`npm run build && npm start`), with Google Chrome installed:

```
APP=http://localhost:3000 OUT=/tmp/e2e npm run e2e          # the whole demo, gate to palette; fails on console errors
APP=http://localhost:3000 npm run e2e:roles                  # every route and export path as each of the five people
APP=http://localhost:3000 OUT=/tmp/add npm run e2e:add       # Add orders in detail
PROTO=/path/to/prototype.html APP=http://localhost:3000 OUT=/tmp/shots npm run shots   # every screen beside the prototype, both themes, with a pixel diff
```

## Where things are

- `src/app/` routes: `/who`, and inside the `(shell)` group `/home`, `/orders`, `/orders/[id]`, `/add`, `/customers`, `/customers/[id]`, `/invoices`, `/people`, `/history`, `/settings/[pane]`. `/` goes to `/home`.
- `src/app/globals.css` the design system, ported from the prototype's CSS.
- `src/sample/` the invented products, customers, people, orders and events. One place, so a database seed can be generated from it.
- `src/lib/importer.ts` the one door to the importer library (`po-importer`); everything that reads, maps, checks or writes rows comes through it. `src/lib/add-orders.ts` and `src/state/add-batch.ts` are the app's side of Add orders; `src/platform/confirm.ts` holds `submitConfirm`.
- `src/sample/lists.ts` the importer's lists (SKU List, Customer Database, approved aliases) built from the sample data.
- `public/samples/` (git-ignored) the importer's look-alike sample POs, copied from the package by `scripts/copy-samples.mjs` before dev and build.
- `src/platform/access.ts` the role helpers (`canPrice`, `canEdit`, `canDeliver`, `canInvoice`, `isOwner`, `visibleOrders`, `lines`, `pinOk`). Pure for now; the server takes them over later. `src/components/shell/Guard.tsx` applies them to routes: a page a role may not open draws Home, as the prototype does.
- `src/state/` client demo state: the store (one localStorage key, "Reset demo data"), the picked person (per browser session) and the theme.
- `src/components/shell/` rail, profile menu, header, keyboard bar, ⌘K palette, ⌘I assistant column.

Purchase orders (`*.pdf`) and spreadsheets (`*.xlsx`) are ignored everywhere except under `fixtures/`, which may hold invented look-alikes only.
