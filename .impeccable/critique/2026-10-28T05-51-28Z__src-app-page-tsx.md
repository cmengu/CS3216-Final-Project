---
target: landing page
total_score: 14
max_score: 32
na_heuristics: 7,10
p0_count: 1
p1_count: 2
target_identity: "file:C:\\Nam-projects\\CS3216-Final-Project\\src\\app\\page.tsx"
target_fingerprint: "sha256:df5902be4da573536ba3f9b1e723efd7d6563b87ea72e642b492b2d24f5f12ab"
target_path: "C:\\Nam-projects\\CS3216-Final-Project\\src\\app\\page.tsx"
timestamp: 2026-10-28T05-51-28Z
slug: src-app-page-tsx
---
Method: dual-agent (A: design review · B: detector and browser evidence)

## Design Health Score (14/32, 44%, Poor; heuristics 7 and 10 n/a: Persuade page)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Stages 2-3 at 14% opacity until scrolled in; form says "Email draft opened" regardless |
| 2 | Match System / Real World | 1 | Promises Outlook import, "AI Triage", "Raise Dispute"; product is PDF upload + "Raise with supplier" |
| 3 | User Control and Freedom | 2 | Node cycle auto-runs forever, no pause; forced smooth scroll; three overlapping nav systems |
| 4 | Consistency and Standards | 2 | ~20 pills as decoration; green/amber as section tags; CTA worded three ways |
| 5 | Error Prevention | 2 | Clipboard failure swallowed; mailto has no fallback |
| 6 | Recognition over Recall | 3 | Clear sticky nav, but figures do not reconcile across stages |
| 7 | Flexibility and Efficiency | n/a | Marketing page |
| 8 | Aesthetic and Minimalist | 1 | Cards 4-5 levels deep, ~20 pills, repeated claims |
| 9 | Error Recognition and Recovery | 1 | Product's error vocabulary absent |
| 10 | Help and Documentation | n/a | Single-page marketing |

## Design Specificity Verdict
Partly authored, mostly category-interchangeable (~1/3 specific). Stage 2 amber price-diff row is the one specific exhibit. Differentiator (never guesses, Needs a person with reason) is absent. Detector: page.tsx 0 static findings; layout.tsx overused-font (deliberate, Geist kept per DESIGN.md); browser 15 findings (14 nested-cards, 1 font).

## Priority Issues
- [CORRECTED, not a defect] Outlook import exists (backend/api/outlook.py, OutlookDialog). The critique's first reading, from docs/API_MAP.md and PRODUCT.md, was wrong because those docs are stale. Remaining issue: page figures (25 emails, 6 PDFs, AI Triage, 1 Click) are unmeasured mock data.
- [P0] Invented metrics and absolute claims (12 secs, 100% Flagged, 0% guessing, 94% faster, SGD 3,460 saved, distorted bar widths, $ vs SGD). PRODUCT.md forbids invented benchmarks. Fix: delete charts and stat strip; state real rules. Commands: clarify, distill.
- [P1] Differentiator absent; stage 2 example does not reconcile (+SGD 52 / +$52 / 2 lines vs one +$42 row; master row red with -$42; "Raise Dispute" implies sending). Fix: one real-fixture-shaped example with price_mismatch, needs_person with reason, match, Ready to pay disabled. Commands: shape, clarify.
- [P1] Mobile 375px: sticky header 199px/812; anchors hidden under it; table clipped (384px in 257px); stage 3 bars collapse; 19/20 tap targets under 44px. Fix: single-row non-sticky header, stacked table, 44px targets. Command: adapt.
- [P2] Motion/a11y: auto-cycle ignores reduced motion and has no pause; smooth scroll ungated; stages stuck at 14% without IntersectionObserver; 10px side dots overlapping card; decorative mocks read as content; chart role=img hides values. Commands: harden, quieter.

## Persona Red Flags
Jordan: no Connect Outlook control; sign-in with demo-account placeholder; "Need more?" cryptic. Casey: 199px sticky header, clipped table, collapsed bars, 36/38px targets. Riley: cycle under reduced motion; 14% stages; silent clipboard failure; false "Email draft opened"; 401 console errors on load. Priya (AP clerk): reads 100%/0% claims as false; no Could not read / Needs a person state; no currency/part/PO in example; never sees Ready to pay.

## Minor Observations
Invented domain hello@invoicechecker.com; M365/ERP not products; contact repeated 3x; duplicate #how-it-works CTAs; aria-current="true" generic; 9 text nodes under 12px; red .ic-price-diff against DESIGN.md; 2px border, hover lift, perpetual scale pulse; inline styles; examples unlike real fixtures; no illustrative marking; sign-in has no way back.

## Questions to Consider
Headline if Outlook does not exist? Main exhibit a refused line with its reason? Audience: the accountant or a buyer? One honest screen with a real workspace screenshot instead of a three-page deck?
