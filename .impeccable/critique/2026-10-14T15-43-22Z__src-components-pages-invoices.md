---
target: invoices
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Nam-projects\\CS3216-Final-Project\\src\\components\\pages\\invoices"
timestamp: 2026-10-14T15-43-22Z
slug: src-components-pages-invoices
---
Method: dual-agent (A: design review · B: detector + browser evidence)

Data caveat: all 12 stored invoices had failed reading (OCR worker failed). Assessment A simulated checked, mismatch, clean and checking states in its own tab; B could test only the list and failed invoices.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Static "Checking" sentence; stale rail count |
| 2 | Match System / Real World | 3 | Good AP words; developer failure copy; undercharge called "Price mismatch" |
| 3 | User Control and Freedom | 1 | No reviewed/ready to pay, no retry, no remove; Esc "Back" hint does nothing |
| 4 | Consistency and Standards | 2 | PO Tracker shell; red overcharge tile when "None found" |
| 5 | Error Prevention | 2 | Totals tile says every price matched with nothing checked |
| 6 | Recognition Rather Than Recall | 3 | A-E markers good; cards and rows drift on long invoices |
| 7 | Flexibility and Efficiency | 1 | Advertised keys don't work; no next/prev, no search; multi-drop keeps only the first file |
| 8 | Aesthetic and Minimalist Design | 3 | Calm; matching lines don't recede; redundant drop band |
| 9 | Error Recovery | 1 | Failed invoice dead end |
| 10 | Help and Documentation | 2 | Scope of "All match" / "so far" / fixture unexplained |
| Total | | 20/40 | Acceptable |

## Design Specificity Verdict
Split. The invoice page (paper sheet, A-E markers tied to Invoice/Sheet/Over-by cards) is product-specific. The list (KPI tiles + avatar/pill rows, hashed-colour initials) is generic, and the shell still says PO Tracker / EGC (SD-08).
Detector: CLI 0 findings. Browser: low-contrast (--ink3, real, about 4.1:1 dark and 3.5:1 light; flaky across runs), overused-font Geist (global), skipped-heading (false positive: hidden assistant panel h4).

## Priority Issues
- [P0] The totals tile claims "every price matched so far" when nothing was checked (InvoicesView.tsx:98-99). Fix: count unchecked invoices; neutral tone. /impeccable harden
- [P1] Failed invoices are dead ends and are folded into "Needs a look" (summary.ts pileOf). Fix: separate "Could not read" pile, human copy, Open PDF/Try again/Remove, header status in every state. /impeccable harden, /impeccable clarify
- [P1] No outcome or pile progression; a clean invoice gives no verified summary and no ready-to-pay action (depends on the open roles decision). /impeccable shape
- [P1] The invoice page breaks at 375px: title collapses, problem cards come after 36 lines, table scrolls sideways. /impeccable adapt
- [P2] Long invoices bury their problems; picked card doesn't scroll to its row; side column isn't sticky; undercharge shows "Over by —"; fixture note below AA. /impeccable layout, /impeccable distill

## Persona Red Flags
Alex: dead hint-bar keys, no search, multi-drop keeps only the first file, upload always navigates away.
Sam: row result shown only by tint and letter; rows not focusable; --ink3 fails AA; truncated pile subtitles; unnamed profile button; no live region.
Priya: no invoice date/PO/total on rows; no handled state; uploads one at a time; unscoped "so far"; no export; year dropped from dates.

## Minor Observations
Loading "–"/"none"; stale rail count; drop zone on mobile, no drag-over feedback; page title "PO Tracker"; invoices.ts name clash; "No. —"; hard-coded tint hex; card unit price vs check invoice_price (low confidence).

## Questions to Consider
- Why "All match" rather than "Ready to pay", and where does approving happen?
- Should clean invoices need a page visit at all?
- Retyped serif sheet, or the actual scan with read values over it?
