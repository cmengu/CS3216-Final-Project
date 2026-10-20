# Parked UI

InvoiceTracker is being cut back to three core features: upload a master list, upload an invoice, and check invoice lines against the master list. Everything here was moved out of routing and navigation so the redesign can start from a clean app. Nothing was deleted.

- Every file keeps its path under `src/`: `src/X` now lives at `src/_parked/X`.
- Parked code still compiles, type-checks and lints. Its tests still run with `npm test`.
- Next.js only builds routes from `src/app/`, so no parked page is reachable.

## What is still active

Outside `src/_parked/`, these are still live:

- **Sign-in:** `src/app/who/page.tsx` and `src/components/pages/WhoGate.tsx` (the demo person picker, with a PIN for Owner and Finance).
- **Placeholder workspace:** `src/app/(shell)/workspace/page.tsx` and `src/components/pages/WorkspaceView.tsx`. `/` redirects here, and every person lands here after sign-in.
- **Invoices (upload and the check):** `src/app/(shell)/invoices/page.tsx` and `src/app/(shell)/invoices/[id]/page.tsx`, with `src/components/pages/invoices/` and `src/checker/`.
- **Core shell:** `src/components/shell/AppShell.tsx` (new, without the sidebar), plus `Header.tsx`, `Guard.tsx` and `context.tsx`.
- **Data and logic layers:** `src/state/`, `src/sample/`, `src/platform/access.ts`, `src/platform/nav.ts` and `src/lib/` stay in place. Parked pages still use them. The sign-in gate uses `state/` and `sample/`.

## Parked pieces

| Piece | Original path | Parked path |
|---|---|---|
| Home page (route) | `src/app/(shell)/home/page.tsx` | `src/_parked/app/(shell)/home/page.tsx` |
| Home view | `src/components/pages/HomeView.tsx` | `src/_parked/components/pages/HomeView.tsx` |
| Home logic and tests | `src/components/pages/home/` | `src/_parked/components/pages/home/` |
| Home styles | `src/app/styles/home.css` | `src/_parked/app/styles/home.css` |
| Catch-all route (drew Home for unknown paths) | `src/app/(shell)/[...rest]/page.tsx` | `src/_parked/app/(shell)/[...rest]/page.tsx` |
| Orders list and order page (routes) | `src/app/(shell)/orders/` | `src/_parked/app/(shell)/orders/` |
| Orders components and logic | `src/components/pages/orders/` | `src/_parked/components/pages/orders/` |
| Customers directory and customer page (routes) | `src/app/(shell)/customers/` | `src/_parked/app/(shell)/customers/` |
| Customers components, figures and tests | `src/components/pages/customers/` | `src/_parked/components/pages/customers/` |
| Customers styles | `src/app/styles/customers.css` | `src/_parked/app/styles/customers.css` |
| People (route and view) | `src/app/(shell)/people/page.tsx`, `src/components/pages/people/` | `src/_parked/app/(shell)/people/page.tsx`, `src/_parked/components/pages/people/` |
| History (route, view, rows and tests) | `src/app/(shell)/history/page.tsx`, `src/components/pages/history/` | `src/_parked/app/(shell)/history/page.tsx`, `src/_parked/components/pages/history/` |
| History styles | `src/app/styles/history.css` | `src/_parked/app/styles/history.css` |
| Settings (routes and views) | `src/app/(shell)/settings/`, `src/components/pages/settings/` | `src/_parked/app/(shell)/settings/`, `src/_parked/components/pages/settings/` |
| Settings styles | `src/app/styles/settings.css` | `src/_parked/app/styles/settings.css` |
| Sidebar (rail), including the "Order demo" and "Assistant" nav groups, the person menu, theme toggle and Reset demo | `src/components/shell/Rail.tsx` | `src/_parked/components/shell/Rail.tsx` |
| Full app frame (rail, assistant column, ⌘K palette, key-hint bar) | `src/components/shell/AppShell.tsx` | `src/_parked/components/shell/AppShell.tsx` |
| Order assistant and Ask (panel) | `src/components/shell/Agent.tsx`, `src/components/Sprout.tsx` | `src/_parked/components/shell/Agent.tsx`, `src/_parked/components/Sprout.tsx` |
| Assistant logic and tests (answers, tools, palette search) | `src/platform/assistant/` | `src/_parked/platform/assistant/` |
| ⌘K command palette | `src/components/shell/Palette.tsx` | `src/_parked/components/shell/Palette.tsx` |
| Keyboard hint bar | `src/components/shell/Kbar.tsx` | `src/_parked/components/shell/Kbar.tsx` |
| Handover and Upload invoice header actions | `src/components/shell/PageActions.tsx` | `src/_parked/components/shell/PageActions.tsx` |
| Order page side pane | `src/components/shell/SidePane.tsx` | `src/_parked/components/shell/SidePane.tsx` |

Handover itself (the copied digest) is `digestLines()` in the parked `HomeView.tsx`.

## Changes made while parking

- **Imports.** Imports that pointed at a moved file now use `@/_parked/...`. That covers the parked files themselves, `src/platform/roles.test.ts` and `src/components/shell/Guard.tsx`.
- **Route types.** The three parked dynamic pages (`customers/[id]`, `orders/[id]`, `settings/[pane]`) used Next's generated `PageProps<"/route">` types. Those routes no longer exist, so the type is now written out as `{ params: Promise<{ id: string }> }` (or `pane`). Put `PageProps<...>` back when re-enabling.
- **Landing route.** `landingFor()` in `src/platform/nav.ts` returns `/workspace` for everyone. It used to return `/invoices` for Owner and Finance and `/home` for everyone else. `WhoGate` falls back to `/workspace` instead of `/home`.
- **Disallowed routes.** `RouteGuard` now draws the workspace, not Home, for a route the person's role may not open.
- **Root route.** `src/app/page.tsx` redirects to `/workspace` instead of `/invoices`.
- **Shell styles.** `src/app/(shell)/layout.tsx` uses the new core `AppShell` and no longer loads `home.css` and `customers.css`. Two rules at the end of `globals.css` (`.app.norail`) drop the rail column and the mobile menu button.

## How to re-enable a piece

1. Move it back with `git mv src/_parked/<path> src/<path>`. Move any parked styles it imports too.
2. Point its imports back from `@/_parked/...` to `@/...`. Search for `@/_parked/` in the files you moved and in their importers.
3. For a route with a dynamic segment, restore `PageProps<"/route">` in its `page.tsx`.
4. For anything that needs the sidebar, assistant or palette, move `Rail.tsx`, `Agent.tsx`, `Palette.tsx`, `Kbar.tsx` and `Sprout.tsx` back. Then swap `src/components/shell/AppShell.tsx` for the parked one, or add those pieces to the core frame. Remove the `.app.norail` rules from `globals.css`.
5. Restore `landingFor()` (Invoices for Owner and Finance, Home for everyone else) and the `/home` fallback in `WhoGate` if Home returns.
6. Run `npm run lint`, `npm run typecheck` and `npm test`.

## Not parked but only used by parked pieces

These stay in place because they are data or logic, not UI. Nothing in the core app uses them.

- `src/state/actions/` (orders, customers, people, settings, the order demo's invoices)
- `src/state/selectors/`
- `src/lib/issues.ts`, `src/lib/ack-text.ts`
- `src/components/bits.tsx` (`Lbl`, `CustomerMark`, `CustomerIcon`)
- `src/components/pages/invoices/invoices.ts` (the order demo's Mark invoiced, not the invoice checker)
- `src/components/pages/invoices/SupplierMark.tsx`, which nothing imports

## End-to-end scripts

`scripts/e2e.mjs`, `scripts/e2e-roles.mjs` and `scripts/shots.mjs` walk through Home, Orders, Customers and History. They will fail until those pages return. They were not changed.
