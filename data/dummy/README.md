# Invented invoice set

All suppliers, customer names, parts, prices, invoices and scenarios here are invented.
Never place client files in this directory. `data/private/` is ignored for that purpose.

`price-sheet.xlsx` has one `Prices` sheet with headers in row 1: `part_number`, `description`,
`currency`, `unit_price`. Prices are numeric Excel cells with four-decimal display precision.
This is a catalogue of agreed prices, not an invoice register. The generator checks it
against `backend/dummy/cases.py` and reuses this committed workbook as a source asset.

`manifest.json` contains the printed invoice record, mistakes, fixture check output, layout,
and digital/scan file hashes. These known answers are for integration; Chen Meng owns the
final evaluation answer-file format. Do not feed them to a model during accuracy evaluation.

| Invoice | Scenario |
| --- | --- |
| 01 | Correct invoice |
| 02 | Unit price 0.015 rather than 0.012; overcharge 15.00 |
| 03 | Unknown part and incorrect line total |
| 04 | Incorrect line total |
| 05 | Invoice total inconsistent with subtotal plus tax |
| 06 | Overcharge and unknown part; slightly tilted scan |
| 07 | Correct alternate catalogue items |
| 08 | Undercharge; scan has an invented received stamp |
| 09 | Subtotal inconsistent with line totals; slightly tilted scan |
| 10 | Correct multipage invoice with 36 rows |

Each digital PDF has an image-only `-scan.pdf` companion with no text layer. Three layout
variants change typography, header alignment and column order. Taxes use an invented test
assumption of 9%; this fixture is not jurisdiction/tax advice. Totals are rounded to cents
while unit prices retain their printed precision.

Regenerate from `backend/` with `.venv/bin/invoice-dummy` after installing the dummy extra
and WeasyPrint native dependencies. Restart the API afterward to refresh fixture hashes.
