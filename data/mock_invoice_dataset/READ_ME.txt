MOCK INVOICE OCR DATASET

14 scanned, image-only PDFs cover seven distinct invoice layouts, two examples each.
The two-page freight and hose templates remain two pages. Other invoices have one page.
The sideways tax-invoice layout is intentionally sideways. Scan skew, faint print,
compression, small text, synthetic stamps and annotations reproduce layout difficulty.
The layouts were reconstructed from the supplied examples. Scan defects are simulated,
not exact copies of the original scan noise. No original document image pixels, logos,
signatures, QR codes, barcodes, contact details or document metadata are included.
All identities, addresses, references, dates, quantities and prices are synthetic.
Generic engineering descriptions and part numbers are retained where legible; company
and product-brand names are replaced or omitted. Mock signature marks are newly drawn.

LAYOUT MAP (source file names omitted to avoid distributing client identifiers)
F01: Freight tax invoice, source packet 1 pages 1-2.
F02: Hose tax invoice, source packet 2 pages 1-2.
F03: Sideways tools tax invoice, source packet 3 page 1.
F04: Machine parts/service tax invoice, source packet 4 page 1.
F05: Electrical proforma invoice, source packet 5 page 1.
F06: Steel commercial invoice, source packet 1 page 12.
F07: Tools commercial invoice, source packet 3 page 3.
Source packet order is the five PDFs in the user's message. Delivery orders,
purchase orders, packing lists, customs documents and chat screenshots are not invoices
and are not included. The CSV and UI screenshots are accounting-import references.

HOW TO TEST
Feed only the invoices folder to OCR. Use master_pricing.xlsx or master_prices.csv
as the agreed-price reference. Keep answer_key out of the OCR/retrieval inputs.
All master prices and contract assumptions are invented, not client commercial terms.
Match by supplier/PO/item/unit/currency; the Key field is a convenient equivalent.
Prices exclude tax and precede the explicit line discount. Hose discount is 5%.
Line amount = ROUND(qty * price, 2) - ROUND(qty * price * discount, 2).
Invoice tax is ROUND(sum of line amounts * stated tax rate, 2).
Rates are synthetic scenario settings, not tax advice or verified tax treatment.
No exchange of USD and SGD is allowed except the explicit freight conversion below.
Freight USD charges use 1.310000 SGD per USD; origin CNY charge uses 0.180000 SGD per CNY.
The master stores freight unit prices after conversion to SGD. Destination fees are per JOB.
Courier freight is one JOB, represented as a flat amount on the proforma invoice.
The repeated steel items are separate invoice rows with the same agreed master price.
The two tools formats use different POs and invoice IDs and are independent cases.
No delivery receipt or remaining-contract-quantity assumptions are made in this price-only set.

EXPECTED RESULTS
Seven invoices (all 01 files) have correct prices. Each 02 invoice has one incorrect
unit price; all other lines and invoice arithmetic remain correct. There are 58 lines:
51 matching lines and 7 mismatches (5 overcharges and 2 undercharges).
The master remains authoritative. Intentional errors are in the generated invoices.
See answer_key for exact line values, expected prices, deltas and invoice totals.
An absolute unit-price difference of more than 0.005 flags a mismatch.

PDF VALIDATION
All 18 pages have empty text extraction, no font resources, no annotations and no
embedded attachments. The PDFs contain only newly generated raster page images.
No OCR/text layer or source PDF objects are retained.
