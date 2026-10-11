# Team handoff examples

All examples refer to invented `data/dummy/invoice-02.pdf`.

- `page-text.json`: actual Docling output from that PDF, including its table, page locations,
  OCR metadata, and original per-page Docling JSON. For Chen Meng's reader input.
- `invoice-record.json`: known generated invoice fields, proposed in `schema.py`. This is
  fixture data, not the result of an OpenAI extraction. For Kalent's checker input.
- `check-result.json`: expected fixture check for the same invoice. The first line is
  overcharged by 0.003 × 5,000 = SGD 15.00. For Nam's result screen.
- `service-response.json`: actual HTTP response from a local fixture-mode upload. Its ID
  belongs to a temporary verification database; upload the PDF to your running service to
  obtain your own ID. It combines real reading with fixture extraction/checking.

These examples were saved after a successful upload. Retrieval was checked after restarting
the server and returned the identical saved response without reprocessing. No external AI
service was called. Restarting with regenerated fixtures does not rewrite historical records.
