# Touchpoints

Where each piece of data appears in the app. Before changing how any of these is read, labelled or formatted, check every place listed. File paths are filled in from the code; keep them current.

## Line result: `check.lines[].status`, `reason`, prices, `difference`

| Where | What it shows or decides | File |
|---|---|---|
| Service → screen | Maps each `LineResult` onto its line; a line with no result becomes `needs_person`; the line's invoice price is the service's `invoice_price` | `src/checker/convert.ts` `toSupplierInvoice` |
| Queue card | Result pill (Matches / Price differs / Not on master list / Needs you) and the attention line ("SGD 159.60 over") | `src/components/invoices/Queue.tsx` `Card` ← `src/checker/present.ts` `statusPill`, `checkPill`, `queueAttention` |
| Lines card | Pill on the card header ("1 of 2 differ"), flagged lines first, each line's pill, attention line and comparison row | `src/components/invoices/CheckPane.tsx` `CheckPane` ← `present.ts` `linesPill`, `orderedLines`, `LINE_PILL`, `lineAttention`, `lineDelta`, `unit` |
| Decision bar | Which actions are offered. Every line `match` → Ready to pay. An overcharge → Raise with supplier. Otherwise Pay anyway only. | `CheckPane.tsx` `DecisionBar` ← `present.ts` `decision` ← `src/checker/review.ts` `choices`, `overSheet` |
| Original invoice | Shared preview frame, price-comparison sidebar, line selection, zoom and download for PDF/XML; original PDF pages or readable original XML fields | `src/app/(app)/invoices/page.tsx` `Workspace` (`marks`) → `src/components/InvoicePreview.tsx`; `PdfView.tsx` `placeMarks` or `XmlView.tsx` |
| Compare drawer | Master list vs invoice price and the difference per item | `src/components/invoices/Dialogs.tsx` `CompareDrawer` ← `present.ts` `unit`, `signed`, `shortDescription` |
| Raise with supplier email | The lines listed in the pre-written message | `Dialogs.tsx` `RaiseDialog`; `CheckPane.tsx` `DecisionBar` (Copy email) ← `present.ts` `raiseEmail`, `mailto` |
| Invoices tab count | Amber count of invoices to decide | `src/components/AppShell.tsx` `Switcher` ← `src/checker/summary.ts` `summarize` (`piles.decide`) |
| Search and filters | To decide / Done membership | `Queue.tsx` `Queue` (`match`, To decide / Done segment) ← `summary.ts` `summarize`, `reviewPile`, `supersededBy` |

## Invoice status: `status`, `error`

| Where | What it shows or decides | File |
|---|---|---|
| Service → screen | `completed` → checked, `reading`/`extracting`/`checking` → checking, anything else → failed | `src/checker/convert.ts` `stateOf` |
| Queue card | Checking… / Couldn't read | `Queue.tsx` `Card` ← `present.ts` `checkPill`, `queueAttention`, `failureSentence` |
| Check pane | The "Couldn't read" card and its Try again button | `CheckPane.tsx` `Failed` ← `present.ts` `failureSentence`; `src/checker/api.ts` `retryInvoice` |
| Decision bar | No decision while checking (409); only Pay anyway when failed | `CheckPane.tsx` `DecisionBar` ← `present.ts` `decision` ← `review.ts` `choices` |
| Upload queue | Archive unpacking, complete batch upload, server-queued progress, skipped/duplicate files and errors (415, 413, 422, 429) | `src/checker/uploads.ts` `precheck`, `refusal`, `run`; `src/checker/archives.ts` `unpackInvoices`; `api.ts` `uploadInvoice`; shown in `Queue.tsx` and `invoices/page.tsx` `GuidedSetup` |
| Guided setup | When setup ends and the workspace appears | `AppShell.tsx` `phaseOf`, `Stepper`; `invoices/page.tsx` `InvoicesView`, `GuidedSetup` |

## Invoice totals: `check.overcharge_total`, `invoice.subtotal`, `tax`, `invoice_total`

| Where | What it shows or decides | File |
|---|---|---|
| Totals card | Subtotal, tax, total | `CheckPane.tsx` `CheckPane` (Totals section) ← `present.ts` `money`, `taxLabel` |
| Decision bar summary | "SGD 159.60 over". When `overcharge_total` is null, never show a total; Ready to pay is not allowed | `present.ts` `decision`, `payAnywayLine` ← `summary.ts` `totalKnown`; shown in `CheckPane.tsx` `DecisionBar`, `Dialogs.tsx` `PayAnywayDialog` |
| Audit trail | Details column for Raised | `present.ts` `auditRows`; shown in `src/app/(app)/audit/page.tsx` |
| CSV export | Total column | `present.ts` `exportReadyToPay`; run from `audit/page.tsx` and `invoices/page.tsx` `Workspace` (`exportCsv`) |

## Outcome: `outcome`, `outcome_reason`, `decided_at`

| Where | What it shows or decides | File |
|---|---|---|
| Queue | To decide vs Done; pill and decided time in Done | `Queue.tsx` `Card` ← `present.ts` `OUTCOME_PILL`, `whenLabel`; piles from `summary.ts` `summarize` |
| Decision bar | Decided state: pill, time, Copy email, Undo | `CheckPane.tsx` `DecisionBar` ← `present.ts` `OUTCOME_PILL`, `whenLabel`, `raiseEmail`; saved by `api.ts` `decideInvoice` |
| Audit trail | One row per decision | `audit/page.tsx` ← `present.ts` `auditRows` |
| CSV export | Only `ready_to_pay` and `ready_to_pay_anyway` | `present.ts` `exportReadyToPay` |
| Nothing to decide | Shown when no invoice lacks an outcome | `Queue.tsx` `Queue` (empty To decide); `CheckPane.tsx` `AllDecided`, chosen in `invoices/page.tsx` `Workspace` |

## Master list (placeholder module `src/masterList/`)

| Where | What it shows or decides | File |
|---|---|---|
| Master list tab | The table, file name, counts, upload date | `src/app/(app)/master-list/page.tsx` ← `src/masterList/index.ts` `useMasterList`, `uploadMasterList`, `replaceMasterList`; `src/masterList/parse.ts` `readMasterCsv` |
| Switcher | Green check when loaded | `AppShell.tsx` `Switcher` (`phase !== "first"`) |
| Guided setup | Step 1 done; side panel facts | `AppShell.tsx` `Stepper`, `phaseOf`; `invoices/page.tsx` `MasterPanel`; `src/app/page.tsx` redirect |
| Compare drawer | Master prices for the supplier | `Dialogs.tsx` `CompareDrawer`: prices are the service's `sheetPrice`; the browser list gives only the footer file name |
| Audit trail | Upload and replace events | `masterList/index.ts` `getMasterListEvents` → `present.ts` `auditRows` |

## Shared helpers

The single modules every screen above must use. If a screen formats or labels any of these itself, that is a bug.

| Helper | Used for | File |
|---|---|---|
| Line status → label and pill colour | Queue card, check pane title, Lines card pills | `src/checker/present.ts` `LINE_PILL`, `checkPill`, `statusPill`, `linesPill` |
| Invoice status → label | Queue card, check pane title and Couldn't read card, decided pills | `src/checker/present.ts` `checkPill`, `failureSentence`, `OUTCOME_PILL`, `statusPill`; state from `src/checker/convert.ts` `stateOf` |
| Allowed outcomes for an invoice | Decision bar buttons and summary | `src/checker/review.ts` `choices`, `allowed`, `overSheet`; `src/checker/present.ts` `decision` |
| Money formatting (currency, decimals) | Queue totals, Totals card, line prices, drawer, email, audit, master list prices | `src/checker/present.ts` `money`, `unit`, `signed` |
