# PO Tracker

Turns the purchase orders a farm gets from hotels and restaurants into one checked order list, and shows each staff role only what that role may see.

**Live demo: https://po-tracker-blue.vercel.app**
No account and no password. Pick a person on the first screen. If it asks for a PIN, type any four digits (for example `1234`).

Built as the CS3216 (NUS) final project. The demo company is Edible Garden City (EGC), a farm that sells herbs and edible flowers. Everything you see in the demo is invented sample data.

## Contents

- [Try the live demo](#try-the-live-demo)
- [What this is](#what-this-is)
- [Facts at a glance](#facts-at-a-glance)
- [Run it on your machine](#run-it-on-your-machine)
- [Checks](#checks)
- [Where things are](#where-things-are)
- [Rules that must not be broken](#rules-that-must-not-be-broken)
- [Working on this with an AI assistant](#working-on-this-with-an-ai-assistant)
- [Words used in this repo](#words-used-in-this-repo)
- [Deploy](#deploy)
- [Help and maintainer](#help-and-maintainer)

## Try the live demo

Open https://po-tracker-blue.vercel.app. It opens on "Who's working?". Pick one of five people:

| Pick | Role | PIN asked? | What this person can do |
| --- | --- | --- | --- |
| **Eunice** | Sales coordinator | No | Sees prices. Adds and confirms orders. Marks orders delivered. **Start here.** |
| **May** | Owner | Yes, any four digits | Everything Eunice can, plus Invoices, People, Settings and the full History. |
| **Farah** | Finance admin | Yes, any four digits | Sees prices. Opens Invoices and marks orders invoiced. Cannot add or confirm orders. |
| **Mei** | Packing lead | No | Sees every order with no prices at all. Marks orders delivered. |
| **Dennis** | Account manager | No | Sees only his two customers (Harbour Hotel, Marina Grand), with no prices. |

A PIN that is not exactly four digits is refused and the box clears.

A five-minute walk, as Eunice:

1. Click **Add orders**, then **use the four sample POs**, then **Process**.
2. Read the four results. `HH-2240` is Ready. `PK-331` is Needs review. `PO_HH-2231.pdf` is a Duplicate of an order already confirmed. The slide deck is Unsupported, because it is not a purchase order.
3. One cell is highlighted: "Edible flower mix (tray)" has no SKU. Pick a SKU in that cell.
4. Click **Copy table** or **Download Excel**, then **Confirm 2 orders**.
5. Open **Orders**. The two new orders are there. Each read PO was already a Draft order with its own page before you confirmed it.
6. Switch person (profile menu, bottom left) to **Mei** and open the same order: the prices are gone. Switch to **Dennis**: he sees only his two customers.
7. **Reset demo data** in the profile menu puts everything back.

Also worth a look, as May: **Settings › Connections**, turn on "WhatsApp paste and chat export", then **Try an example** and **Read order**. Press `⌘K` anywhere for search, and `⌘I` for the assistant column.

The demo keeps its data in your own browser. Nothing you do is sent to a server or seen by anyone else. The live site is deployed by hand from `main`, so it can be a few commits behind this repo.

## What this is

**The problem.** A farm's sales team receives purchase orders (POs) as PDFs from many buyers. Every buyer prints its PO in a different layout and calls the same product by a different name. Someone retypes each PO into a spreadsheet. That is slow, and a wrong SKU or a PO entered twice costs money.

**What the app does.**

- Reads a PO file and turns it into rows: customer, SKU, quantity, price, delivery date, location.
- Marks what it could not match, so a person fills only those cells.
- Refuses a PO it has seen before (Duplicate) and a file that is not a PO (Unsupported).
- Keeps every order in one list with its state (Draft, Confirmed, Needs check, Blocked or Delivered) and marks the ones already invoiced.
- Shows each role only what it may see. Packing never sees a price. An account manager sees only their own customers.

**What it is not, yet.** There is no server, no database and no real login. The five people and the PIN are a demo of the role rules, not security. See [Facts at a glance](#facts-at-a-glance).

**The design it follows.** The approved design is the Version 16 prototype (`egc-platform-prd/prototype.html`), which is kept outside this repo. Where this app and the prototype differ, the prototype wins. Ask the maintainer for the file.

## Facts at a glance

- **Stack:** Next.js 16.3.8 (App Router), React 19.2.8, TypeScript 5. Tests: Vitest 5. Browser walks: `playwright-core` driving your installed Google Chrome.
- **Runs where:** in the browser only. There are no server routes and no API calls.
- **Data:** invented sample data in `src/sample/`, copied into one `localStorage` key on first load (`KEY` in `src/state/demo-store.ts`).
- **Reading POs:** done by a separate library, `po-importer`, from the private repo `neokh719/PO-Transformer-KH` (tag `v0.3.0`). This repo does not contain it.
- **Roles:** five, defined in `src/sample/people.ts`. Every permission is one function in `src/platform/access.ts`.
- **Deploy:** Vercel, built on a laptop and uploaded. See [Deploy](#deploy).
- **Node:** 20.9 or newer.

## Run it on your machine

You need:

- Node 20.9 or newer.
- Read access on GitHub to `neokh719/PO-Transformer-KH`. Without it `npm install` cannot fetch the importer and fails. If you only want to see the app, use the live demo.

```
npm install
npm run dev
```

Then open http://localhost:3000 and follow [Try the live demo](#try-the-live-demo).

`npm install` and `npm run dev` each run two small scripts first. `scripts/private-lists.mjs` writes an empty `src/sample/egc-samples.private.json` if you do not have one (see [rule 2](#rules-that-must-not-be-broken)). `scripts/copy-samples.mjs` copies the sample POs out of the importer package into `public/samples/`.

## Checks

Run all four before you open a pull request:

```
npm test             # Vitest: role rules for all five people, Add orders logic, the importer's sample POs
npm run lint
npm run typecheck
npm run build
```

Browser walks, against a running app (`npm run build && npm start`), with Google Chrome installed:

```
APP=http://localhost:3000 OUT=/tmp/e2e npm run e2e          # the whole demo, start to finish; fails on any console error
APP=http://localhost:3000 npm run e2e:roles                  # every page and export as each of the five people
APP=http://localhost:3000 OUT=/tmp/add npm run e2e:add       # Add orders in detail
PROTO=/path/to/prototype.html APP=http://localhost:3000 OUT=/tmp/shots npm run shots   # every screen beside the prototype, both themes, with a pixel diff
```

`npm run lint` also scans `.vercel/output/` if you have built for Vercel on this machine, and reports errors in that generated code. Those are not source errors.

## Where things are

| Path | What is in it |
| --- | --- |
| `src/app/` | The pages. `/who` is the person picker. Inside the `(shell)` group: `/home`, `/orders`, `/orders/[id]`, `/add`, `/customers`, `/customers/[id]`, `/invoices`, `/people`, `/history`, `/settings/[pane]`. `/` goes to `/home`. |
| `src/app/globals.css` | The design system, ported from the prototype's CSS. |
| `src/components/pages/` | One view per page, with its pure logic beside it (`logic.ts`, `figures.ts`). |
| `src/components/shell/` | The frame around every page: side rail, profile menu, header, keyboard bar, `⌘K` palette, `⌘I` assistant column, and `Guard.tsx`. |
| `src/platform/access.ts` | The role rules: `canPrice`, `canEdit`, `canDeliver`, `canInvoice`, `isOwner`, `visibleOrders`, `lines`, `pinOk`, `navAllowed`. |
| `src/platform/confirm.ts` | `submitConfirm`: what happens when an order is confirmed. |
| `src/platform/assistant/` | The `⌘K` search and the `⌘I` assistant. |
| `src/lib/importer.ts` | The one door to the `po-importer` library. Nothing else imports the library. |
| `src/lib/add-orders.ts` | The Add orders logic, pure. `src/state/actions/add.ts` is the same feature's store side. |
| `src/sample/` | The invented products, customers, people, orders and events. `lists.ts` builds the importer's lists from them. |
| `src/state/` | The demo store (`demo-store.ts`), the picked person (`session.ts`), the theme, and one actions file per feature. |
| `scripts/` | The two pre-run scripts, the three browser walks and the screenshot comparison. |
| `public/samples/` | Git-ignored. The sample POs, copied from the importer package before `dev` and `build`. |

How a PO moves through the code: file dropped on `/add` → `src/state/actions/add.ts` → `src/lib/importer.ts` (the library reads it) → rows and a Draft order in the store → Confirm → `src/platform/confirm.ts`.

How a role is applied: `src/components/shell/Guard.tsx` asks `navAllowed()` for every page. A page a role may not open draws Home instead. Price fields are removed by `lines()`, not hidden by the page.

## Rules that must not be broken

1. **Never commit a real purchase order, even a redacted one.** Real POs carry a customer's prices and buying habits, and git history is permanent. `*.pdf` and `*.xlsx` are git-ignored everywhere except under `fixtures/`, which may hold invented look-alikes only. The four sample POs are invented look-alikes that ship inside the importer package (`src/sample/sample-pos.json` names them).
2. **Never commit EGC's real buyers, item codes or prices.** This repo is public. `src/sample/egc-samples.ts` reads them from `src/sample/egc-samples.private.json`, which git ignores (`*.private.*`), so they stay on the machine that has the file. Without the file the demo runs on the invented lists alone. Never paste its contents into a tracked file, a test, a commit message or an issue.
3. **Everything in `src/sample/` is invented.** Names, places, contacts and prices there are made up. Keep it that way.
4. **Every role check goes through `src/platform/access.ts`.** Do not write `role === "owner"` in a page. One file is what lets the server take the checks over later without a hunt through the pages.
5. **Every call to the importer goes through `src/lib/importer.ts`.** The library changes between tags; one door keeps a version bump to one file.
6. **The prototype wins.** Do not restyle a screen or reword its text to taste. Change `globals.css` values only when the prototype's value changed.

## Working on this with an AI assistant

Point the assistant at this file first. The facts below are the ones it cannot work out from the code.

- **This Next.js is newer than most training data.** APIs and file conventions may differ from what the assistant expects. The matching docs are in `node_modules/next/dist/docs/`; have it read the relevant guide before it writes code. `next dev` writes an `AGENTS.md` at the repo root that says the same.
- **The importer is not in this repo.** Its source is in `node_modules/po-importer/` after install. Its types are re-exported from `src/lib/importer.ts`.
- **There is no backend.** A question about "the API" or "the database" has no answer here. State is the store in `src/state/demo-store.ts`.
- **The six rules above apply to an assistant too**, rule 2 above all: it must not read `*.private.*` files into a commit, a test or a chat that leaves the machine.

Where to look, by question:

| Question | Start in |
| --- | --- |
| Who can see or do what? | `src/platform/access.ts`, then `src/platform/roles.test.ts` |
| Why does a PO come out Ready, Needs review, Duplicate or Unsupported? | `src/lib/add-orders.ts`, `src/state/actions/add.ts` |
| How is a buyer's wording matched to a SKU? | `src/sample/lists.ts` (approved aliases), `src/lib/importer.ts` |
| What does an order hold, and what states can it be in? | `src/sample/types.ts`, `src/state/actions/orders.ts` |
| Where does the sample data come from? | `src/sample/index.ts` |
| What does a page look like and why? | `src/components/pages/`, `src/app/globals.css` |
| What must stay true end to end? | `scripts/e2e.mjs`, `scripts/e2e-roles.mjs` |

To confirm a change: `npm test && npm run typecheck && npm run build`, then the browser walks in [Checks](#checks).

## Words used in this repo

- **PO** — purchase order. The document a buyer sends to say what it wants delivered and when.
- **SKU** — the farm's own code for one product, for example `EGC-PTND` (pea tendrils 35g).
- **Alias** — a buyer's wording for a product ("Edible flower mix (tray)") tied to a SKU. A person approves an alias once; after that the wording matches by itself.
- **Layout** or **reader** — the shape of one buyer's PO. The importer has one reader per layout.
- **Outlet** — the kitchen or department inside a buyer that the goods go to.
- **Draft order** — a PO that has been read but not yet confirmed by a person.
- **Fingerprint** — a short code worked out from a PO file, used to spot the same PO sent twice.
- **Lists** or **master data** — the SKU List, the Customer Database and the approved aliases that the importer matches against.
- **Rail** — the menu down the left side.
- **EGC** — Edible Garden City, the demo company.

## Deploy

Vercel's servers cannot fetch the private importer, so the site is built on a laptop and uploaded. No push to GitHub deploys anything.

```
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod --yes
```

**Before you build for deploy, check `src/sample/egc-samples.private.json`.** The build puts whatever is in that file into the public site. If the file holds the real lists, move it aside first and let `scripts/private-lists.mjs` write an empty one.

## Help and maintainer

- Questions and bugs: open an issue on this repo.
- Maintainer: Chen Meng ([@cmengu](https://github.com/cmengu)).
- Licence: none chosen yet.
