# PO Tracker

An order-tracking app for a small food supplier that shows each staff role only what that role may see.

**Live demo: https://po-tracker-blue.vercel.app**
No account and no password. Pick a person on the first screen. If it asks for a PIN, type any four digits (for example `1234`).

Built for the CS3216 (NUS) final project. The demo company is Edible Garden City (EGC), a farm that sells herbs and edible flowers. Everything you see is invented sample data.

**Anyone can run this repo.** It has no private dependencies: `npm install`, then `npm run dev`.

**What changed on 10 October 2026.** The Add orders page, which read purchase order PDFs, was removed together with the private package it needed. The team's next product is an invoice checker, and it does not read purchase orders. The live demo is an older build and still shows Add orders until it is redeployed.

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
| **Eunice** | Sales coordinator | No | Sees prices. Confirms orders. Marks orders delivered. **Start here.** |
| **May** | Owner | Yes, any four digits | Everything Eunice can, plus Invoices, People, Settings and the full History. |
| **Farah** | Finance admin | Yes, any four digits | Sees prices. Opens Invoices and marks orders invoiced. Cannot confirm orders. |
| **Mei** | Packing lead | No | Sees every order with no prices at all. Marks orders delivered. |
| **Dennis** | Account manager | No | Sees only his two customers (Harbour Hotel, Marina Grand), with no prices. |

A PIN that is not exactly four digits is refused and the box clears.

A five-minute walk, as Eunice:

1. Home shows today's deliveries and anything that needs a check.
2. Click **Orders**, then open `HH-2231`. The page shows the order's lines, the file it came from and its timeline.
3. Click **Suggest reply** to draft the acknowledgement to the customer. Add a **Comment**. Click **Mark delivered**.
4. Switch person (profile menu, bottom left) to **Mei** and open the same order: the prices are gone. Switch to **Dennis**: he sees only his two customers.
5. Switch to **Farah** (PIN `1234`), open **Invoices**, and mark the delivered order invoiced.
6. Switch to **May** (PIN `1234`) for **People** and **Settings**.
7. **Reset demo data** in the profile menu puts everything back.

Press `⌘K` anywhere for search, and `⌘I` for the assistant column.

The demo keeps its data in your own browser. Nothing you do is sent to a server or seen by anyone else.

## What this is

**The problem.** A supplier's orders, delivery states and invoices live in spreadsheets and chat threads. Sales, packing and finance each need a different slice, and prices should not reach everyone.

**What the app does.**

- Keeps every order in one list with its state (Draft, Confirmed, Needs check, Blocked or Delivered) and marks the ones already invoiced.
- Shows each order's lines, source file, timeline and comments on one page.
- Shows each role only what it may see. Packing never sees a price. An account manager sees only their own customers.
- Lists delivered orders for finance to invoice.

**What it is not, yet.** There is no server, no database and no real login. The five people and the PIN are a demo of the role rules, not security. See [Facts at a glance](#facts-at-a-glance).

**The design it follows.** The approved design is the Version 16 prototype (`egc-platform-prd/prototype.html`), which is kept outside this repo. Where this app and the prototype differ, the prototype wins. Ask the maintainer for the file.

## Facts at a glance

- **Stack:** Next.js 16.3.8 (App Router), React 19.2.8, TypeScript 5. Tests: Vitest 5. Browser walks: `playwright-core` driving your installed Google Chrome.
- **Runs where:** in the browser only. There are no server routes and no API calls.
- **Data:** invented sample data in `src/sample/`, copied into one `localStorage` key on first load (`KEY` in `src/state/demo-store.ts`).
- **Roles:** five, defined in `src/sample/people.ts`. Every permission is one function in `src/platform/access.ts`.
- **Deploy:** Vercel. See [Deploy](#deploy).
- **Node:** 20.9 or newer.

## Run it on your machine

You need Node 20.9 or newer. Nothing else.

```
npm install
npm run dev
```

Then open http://localhost:3000 and follow [Try the live demo](#try-the-live-demo).

## Checks

Run all four before you open a pull request:

```
npm test             # Vitest: role rules for all five people, order actions, the assistant and search
npm run lint
npm run typecheck
npm run build
```

Browser walks, against a running app (`npm run build && npm start`), with Google Chrome installed:

```
APP=http://localhost:3000 OUT=/tmp/e2e npm run e2e          # the whole demo, start to finish; fails on any console error
APP=http://localhost:3000 npm run e2e:roles                  # every page and export as each of the five people
PROTO=/path/to/prototype.html APP=http://localhost:3000 OUT=/tmp/shots npm run shots   # every screen beside the prototype, both themes, with a pixel diff
```

`npm run lint` also scans `.vercel/output/` if you have built for Vercel on this machine, and reports errors in that generated code. Those are not source errors.

## Where things are

| Path | What is in it |
| --- | --- |
| `src/app/` | The pages. `/who` is the person picker. Inside the `(shell)` group: `/home`, `/orders`, `/orders/[id]`, `/customers`, `/customers/[id]`, `/invoices`, `/people`, `/history`, `/settings/[pane]`. `/` goes to `/home`. |
| `src/app/globals.css` | The design system, ported from the prototype's CSS. |
| `src/components/pages/` | One view per page, with its pure logic beside it (`logic.ts`, `figures.ts`). |
| `src/components/shell/` | The frame around every page: side rail, profile menu, header, keyboard bar, `⌘K` palette, `⌘I` assistant column, and `Guard.tsx`. |
| `src/platform/access.ts` | The role rules: `canPrice`, `canEdit`, `canDeliver`, `canInvoice`, `isOwner`, `visibleOrders`, `lines`, `pinOk`, `navAllowed`. |
| `src/platform/assistant/` | The `⌘K` search and the `⌘I` assistant. |
| `src/sample/` | The invented products, customers, people, orders and events. |
| `src/state/` | The demo store (`demo-store.ts`), the picked person (`session.ts`), the theme, and one actions file per feature. |
| `scripts/` | The two browser walks and the screenshot comparison. |

How a role is applied: `src/components/shell/Guard.tsx` asks `navAllowed()` for every page. A page a role may not open draws Home instead. Price fields are removed by `lines()`, not hidden by the page.

## Rules that must not be broken

1. **Never commit a real client document, even a redacted one.** Real purchase orders and invoices carry a company's prices and buying habits, and git history is permanent. `*.pdf` and `*.xlsx` are git-ignored everywhere except under `fixtures/`, which may hold invented look-alikes only.
2. **Never commit real names, codes or prices.** This repo is public. Any file named `*.private.*` is git-ignored, so real data kept on your machine under such a name cannot be committed by accident. Never paste real data into a tracked file, a test, a commit message or an issue.
3. **Everything in `src/sample/` is invented.** Names, places, contacts and prices there are made up. Keep it that way.
4. **Every role check goes through `src/platform/access.ts`.** Do not write `role === "owner"` in a page. One file is what lets a server take the checks over later without a hunt through the pages.
5. **The prototype wins.** Do not restyle a screen or reword its text to taste. Change `globals.css` values only when the prototype's value changed.

## Working on this with an AI assistant

Point the assistant at this file first. The facts below are the ones it cannot work out from the code.

- **This Next.js is newer than most training data.** APIs and file conventions may differ from what the assistant expects. The matching docs are in `node_modules/next/dist/docs/`; have it read the relevant guide before it writes code. `next dev` writes an `AGENTS.md` at the repo root that says the same.
- **There is no backend.** A question about "the API" or "the database" has no answer here. State is the store in `src/state/demo-store.ts`.
- **The five rules above apply to an assistant too**, rule 2 above all: it must not read `*.private.*` files into a commit, a test or a chat that leaves the machine.

Where to look, by question:

| Question | Start in |
| --- | --- |
| Who can see or do what? | `src/platform/access.ts`, then `src/platform/roles.test.ts` |
| What does an order hold, and what states can it be in? | `src/sample/types.ts`, `src/state/actions/orders.ts` |
| Where does the sample data come from? | `src/sample/index.ts` |
| What does a page look like and why? | `src/components/pages/`, `src/app/globals.css` |
| What must stay true end to end? | `scripts/e2e.mjs`, `scripts/e2e-roles.mjs` |

To confirm a change: `npm test && npm run typecheck && npm run build`, then the browser walks in [Checks](#checks).

## Words used in this repo

- **PO** — purchase order. The document a buyer sends to say what it wants delivered and when.
- **SKU** — the farm's own code for one product, for example `EGC-PTND` (pea tendrils 35g).
- **Alias** — a buyer's wording for a product ("Edible flower mix (tray)") tied to a SKU. A person approves an alias once; after that the wording matches by itself.
- **Outlet** — the kitchen or department inside a buyer that the goods go to.
- **Draft order** — an order that a person has not yet confirmed.
- **Rail** — the menu down the left side.
- **EGC** — Edible Garden City, the demo company.

## Deploy

The live site is on Vercel and is deployed by hand. No push to GitHub deploys anything yet.

```
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod --yes
```

The repo no longer needs a private package, so Vercel could also build it straight from GitHub once the project is linked.

## Help and maintainer

- Questions and bugs: open an issue on this repo.
- Maintainer: Chen Meng ([@cmengu](https://github.com/cmengu)).
- Licence: none chosen yet.
