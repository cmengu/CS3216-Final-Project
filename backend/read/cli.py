import argparse
from pathlib import Path

from .reader import read_pdf


def main():
    parser = argparse.ArgumentParser(description="PDF to page text, tables and OCR metadata")
    parser.add_argument("input", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--force-ocr", action="store_true")
    args = parser.parse_args()
    document = read_pdf(args.input, force_ocr=args.force_ocr)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(document.model_dump_json(indent=2) + "\n")
    print(f"Read {document.page_count} pages → {args.out}")
