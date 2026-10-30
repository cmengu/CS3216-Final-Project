# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is an accounts-payable (AP) or finance clerk at a business that buys from many suppliers. Supplier invoices arrive as PDFs, often scanned, skewed or faint, in many different layouts. The clerk's job is to check each invoice against the prices the business agreed with that supplier before the invoice is paid.

## Product Purpose

The Invoice Checker reads a supplier's invoice PDF, fills the agreed fields, and checks every line against the agreed price sheet. It exists so the clerk no longer re-keys invoices and compares them line by line by hand.

Success means three things, all confirmed:

- **Catch overcharges.** Every line priced above the agreed price is found before the invoice is paid.
- **Save checking time.** Only the lines that need a person get the clerk's attention.
- **Trust the result.** The checker never guesses. Anything it is unsure of goes to a person with a reason, so an invoice marked clear can be paid without checking it again.

## Positioning

The checker is conservative by design. A step that cannot do its job fails with a reason; it never falls back to a made-up answer. It does not fuzzy-match damaged descriptions, does not invent item codes the document does not print, and does not work out money in the browser. When the check is incomplete or uncertain, it reports no overcharge total rather than a partial one. The claim is that "clear" means clear.

## Operating Context

- Invoices are uploaded as PDFs (up to 20 MiB and 1 to 30 pages) or Vietnamese HDon XML files (up to 20 MiB). ZIP/RAR archives up to 50 MiB are unpacked locally, including folders, with limits of 100 MiB expanded and 1,000 entries. Nested/password-protected archives are unsupported.
- For PDFs, the service reads with Docling OCR and extracts printed fields with a model. XML fields are read directly without OCR or a model. Both use the same price-sheet checks (CSV or Excel) and preserve uncertainty for review.
- Matching uses supplier, PO, invoice date, currency, item code and unit. Charges with no code need an exact description match. Printed discounts, tax rates and printed exchange rates are applied; price differences above 0.005 are flagged, undercharges included.
- Each invoice's check is labelled by what it found: an amount over, Needs a person, Unknown part, Could not read or Could not check, Checking, or All match. A checked invoice whose total the service will not stand behind needs a person, never "All match". Each invoice page shows the invoice as read, the lines that need a look, and the amount over.
- The clerk ends each invoice with an outcome: Ready to pay (only when checked in full and every line matches), Ready to pay anyway (with a reason), or Raise with supplier (when a line is over the sheet price). The list's piles are To decide and Done. Ready-to-pay invoices export as a CSV, and an overcharge gives a dispute note to copy; nothing is sent from the app.
- Real invoice layouts in scope include freight, hose, tools, machine parts/service, electrical proforma and steel commercial invoices, in SGD and USD.

## Capabilities and Constraints

- **Stack:** Next.js 16 (App Router), React 19, TypeScript screens; a separate Python FastAPI + SQLite service in `backend/`. The screens read the service at `NEXT_PUBLIC_INVOICE_API`.
- **Modes:** `fixture` replays known answers for the dummy PDFs and must never be presented as a live check (the screens label it "Fixture answers, not a live check"); `live` runs the real reader and model.
- **Money is the service's.** Line and invoice overcharge figures come from the service; the screens display them and never compute them.
- **Terminology in use:** Needs a look, Needs a person, Price mismatch, Unknown part, No part number, Over by, Overcharged so far, The invoice as read, Sheet price.
- **Legacy:** the PO Tracker screens (orders, customers, people, history, settings) for the Edible Garden City demo stay in the app under an "Order demo" heading in the rail. They are not the product future design work serves. The shell is branded Invoice Checker and opens on Invoices; the rail is grouped so more tools can join it later.
- **Roles (decided 15 October 2026):** the AP clerk alone decides whether a checked invoice can be paid; there is no second sign-off in the app. The existing role rules in `src/platform/access.ts` belong to the PO demo.
- **Rhythm:** the clerk checks invoices as they arrive through the week, one at a time, rather than in one batch before a payment run.
- **Open decision: the Version 16 prototype.** The README says the external Version 16 prototype wins over the app's look and wording. Whether that rule binds the Invoice Checker screens has not been decided.
- **Open product questions** are tracked in `docs/review/2026-10-11-backend.md` section 5 (Q-1 to Q-7), including matching by description when no part code is printed, and how to check a flat charge that prints only an amount.

## Brand Commitments

- Product name: **Invoice Checker**.
- Repo writing is plain and literal: short declarative sentences, no jargon, the reason always stated ("Could not be checked. reading: No readable text or tables"). Error copy names what happened and what the person can do.

## Evidence on Hand

- `data/dummy/`: 10 invented invoices, each with a scanned copy, plus an Excel price sheet and a manifest.
- `data/mock_invoice_dataset/`: 14 synthetic scanned invoices across seven layouts, a master price sheet (CSV and Excel) and an answer key. Whether this set may be published is open (Q-7).
- Measured on 11 October 2026: the reader's text holds 57 of 58 line amounts; the price check with perfectly read fields is right on 16 of 58 lines. No accuracy numbers from a real model run exist yet.
- No real customers, testimonials, case studies or benchmarks exist. Do not invent them. All names, prices and documents in the repo are invented, and no real client document, name, code or price may ever enter it.

## Product Principles

1. **Never guess.** An uncertain result goes to a person with its reason; silence or a made-up figure is a failure.
2. **"Clear" must be safe to pay.** Every design and copy decision protects the clerk's ability to trust a clean result.
3. **Spend the clerk's attention only where it is needed.** Lines that match recede; lines that need a person lead.
4. **Show the source.** The clerk can always see the invoice as read and why a line was flagged.
5. **Honest about the mode.** Replayed or test answers are always marked as such.
