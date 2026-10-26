# Mock invoice model benchmark, 26 October 2026

**B-20. Live comparison after the main merge.** Ran the current application extraction,
verification/refinement and uploaded-master checking code at commit `2c4f9b7` against all
14 synthetic mock invoices (18 scanned pages, 58 lines). These are fresh model calls,
not fixture answers. Seven lines deliberately contain wrong prices: five overcharges and
two undercharges. The answer keys were used only for scoring frozen predictions.

OpenAI used `gpt-6-luna` with reasoning effort `none`. Ollama used `gemma4:e4b` with
`qwen3.5:4b` as the configured challenger/correction model. This compares the application's
two provider pipelines; it is not a comparison of identical prompts or isolated base models.
Both used the same normalized `master_prices.csv`, without changing the local .env files.

## Results

| Metric | OpenAI | Ollama pipeline |
| --- | ---: | ---: |
| Completed invoices | 14/14 | 14/14 |
| Correct line classifications | 57/58 (98.3%) | 58/58 (100%) |
| Intentional price errors detected | 7/7 | 7/7 |
| False price-mismatch flags | 0 | 0 |
| Additional lines requiring manual review | 1 | 0 |
| Invoices with every line classified correctly | 13/14 | 14/14 |
| Correct comparison unit prices | 58/58 | 58/58 |
| Correct extracted line amounts | 58/58 | 58/58 |
| Correct line count | 14/14 | 14/14 |
| Mean time per invoice, excluding OCR | 6.293 s | 4.474 s |
| Median time per invoice, excluding OCR | 5.356 s | 3.121 s |
| Slowest invoice, excluding OCR | 18.987 s | 8.845 s |
| Sum of per-invoice processing time | 88.102 s | 62.640 s |
| Model requests, including corrections | 15 | 37 |

Ollama used 28.9% less processing time in this run. OpenAI made 15 requests; the local
pipeline made 32 Gemma and five Qwen requests. Different tokenizers and prompt strategies
mean request/token counts are not direct measures of efficiency or equivalent work.

| Timed stage, sum over 14 invoices | OpenAI | Ollama pipeline |
| --- | ---: | ---: |
| Loading shared OCR JSON | 0.125 s | 0.257 s |
| Extraction, verification and any corrections | 87.948 s | 62.348 s |
| Deterministic price checking | 0.029 s | 0.035 s |

The extraction stage includes 87.934 s / 60.949 s of model HTTP requests respectively.
Deterministic extraction verification accounts for only 0.0084 s / 0.0088 s within that
stage. Model calls dominate these measured times. OpenAI reported 32,756 input and 7,793
output tokens. Ollama reported 70,939 prompt and 10,023 output tokens. No monetary cost
estimate was calculated. Preparation requests to obtain missing OCR are outside these counts.

## Per-invoice results

Times include extraction, verification/corrections and checking; they exclude OCR.

| Invoice PDF stem | Lines | OpenAI seconds | Ollama seconds | OpenAI correct | Ollama correct |
| --- | ---: | ---: | ---: | ---: | ---: |
| F01_freight_tax_01 | 7 | 8.42 | 7.44 | 7/7 | 7/7 |
| F01_freight_tax_02 | 7 | 5.41 | 7.04 | 7/7 | 7/7 |
| F02_hose_tax_01 | 2 | 5.30 | 3.05 | 2/2 | 2/2 |
| F02_hose_tax_02 | 2 | 5.43 | 3.07 | 2/2 | 2/2 |
| F03_sideways_tax_01 | 2 | 4.97 | 2.69 | 2/2 | 2/2 |
| F03_sideways_tax_02 | 2 | 3.71 | 4.44 | 2/2 | 2/2 |
| F04_service_tax_01 | 3 | 6.17 | 4.73 | 2/3 | 3/3 |
| F04_service_tax_02 | 3 | 5.53 | 3.17 | 3/3 | 3/3 |
| F05_proforma_01 | 2 | 3.96 | 2.64 | 2/2 | 2/2 |
| F05_proforma_02 | 2 | 3.53 | 2.70 | 2/2 | 2/2 |
| F06_steel_commercial_01 | 11 | 18.99 | 8.85 | 11/11 | 11/11 |
| F06_steel_commercial_02 | 11 | 8.13 | 7.33 | 11/11 | 11/11 |
| F07_tools_commercial_01 | 2 | 3.94 | 2.76 | 2/2 | 2/2 |
| F07_tools_commercial_02 | 2 | 4.61 | 2.74 | 2/2 | 2/2 |

## What needs attention

OpenAI assigned `A14L-0156-0001#24R` to line 2 of `F04_service_tax_01.pdf` instead of
`BASICCHARGE`. Docling merged preceding text into that row. Its quantity, unit price and
amount were correct, but the wrong code failed the master context/unit match. The checker
returned `needs_person`, rather than incorrectly approving it. Ollama's existing normalization
recovered the correct code. Neither pipeline missed a deliberately incorrect price.

The 100% Ollama result above is line classification accuracy, not perfect extraction of
every field. The F05/F06 layouts print a final total without separate subtotal/tax amounts.
The accounting answer CSV supplies computed subtotal/zero-tax values; scoring these as
mandatory printed fields would penalize correct nulls. Both providers match 105/112 raw CSV
header values, or 111/112 fields under the extraction contract requiring null for unprinted
fields. OpenAI filled an unprinted subtotal in F06_02; Ollama did so in F06_01. The raw CSV
score and the separate printed-field policy score are both retained in the JSON report.

## Scope and reproducibility

This is one pass on a small synthetic dataset already used to tune the application's
heuristics. It is not a held-out accuracy estimate, a repeated-run stability test, a load
test, or evidence that Ollama will always outperform OpenAI on new supplier layouts.

Each provider received the exact same Docling OCR JSON, verified by both PDF hash and OCR
JSON hash. Seven documents were reused from earlier mock-only OCR, and seven were obtained
through a dedicated new session on the Ubuntu app. A separate control session remained
empty before and after preparation; existing user records and master lists were untouched.
Preparation created one synthetic master and seven synthetic invoice records in that new
benchmark session. These preparation calls/results are not counted as model benchmark runs.

Windows Application Control blocked local PyTorch (`torch_python.dll`), so there is no
fresh all-invoice OCR timing or total upload-to-result latency measurement here. The reported
times include model network latency, any model loading inside requests and correction calls;
they exclude OCR, application startup, upload transport, persistence and browser rendering.
Two inference batches ran concurrently against independent providers. Ollama reported
version 0.40.4, 8,192-token contexts, Q4_K_M quantization and VRAM-resident models during
the run; the physical GPU model was not independently verified. Ollama's reported aggregate
model loading time across the 37 measured requests was 1.227 s.

Raw predictions, per-request timing/token metadata, OCR provenance, scorer, environment and
CSV export are kept locally in ignored `backend/runtime/model-benchmark-20261026/`:

- `comparison.json`: aggregate and per-invoice scores.
- `per-invoice.csv`: spreadsheet-friendly timings and classifications.
- `openai/report.json`, `ollama/report.json`: frozen predictions and model calls.
- `ocr-metadata.json`, `environment.json`: provenance and runtime context.
- `run.py`: preparation, provider runs and scoring. Running `score` repeats scoring without
  making provider requests; provider modes resume existing outputs rather than rerunning them.

No production application code, credentials or model configuration was changed for this
benchmark. Prefer testing unseen invoices and repeating timed runs before making a broader
model-selection decision.
