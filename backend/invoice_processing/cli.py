"""Local entry points. The backend owner can call the same functions from a worker."""

import argparse
import os
import sys
from pathlib import Path

from .comparator import compare_invoice
from .docling_reader import read_pdf
from .extractor import extract_invoice
from .schemas import Extraction, MasterSnapshot, ParsedDocument


def write_model(path, model):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(model.model_dump_json(indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Docling → OpenAI → invoice comparison")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("parse", "extract", "compare", "process"):
        sub = commands.add_parser(name)
        sub.add_argument("input", type=Path)
        sub.add_argument("--out", type=Path, required=True)
        if name in ("parse", "process"):
            sub.add_argument("--force-ocr", action="store_true")
        if name in ("extract", "process"):
            sub.add_argument("--model", default=os.environ.get("OPENAI_MODEL"))
        if name in ("compare", "process"):
            sub.add_argument("--master", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "parse":
            write_model(args.out, read_pdf(args.input, force_ocr=args.force_ocr))
        elif args.command == "extract":
            document = ParsedDocument.model_validate_json(args.input.read_text())
            write_model(args.out, extract_invoice(document, model=args.model))
        elif args.command == "compare":
            extraction = Extraction.model_validate_json(args.input.read_text())
            snapshot = MasterSnapshot.model_validate_json(args.master.read_text())
            write_model(args.out, compare_invoice(extraction, snapshot))
        else:
            # Validate config/reference before model downloads or any billable request.
            if not args.model or not os.environ.get("OPENAI_API_KEY"):
                raise ValueError("Set OPENAI_API_KEY and OPENAI_MODEL before processing")
            snapshot = MasterSnapshot.model_validate_json(args.master.read_text())
            document = read_pdf(args.input, force_ocr=args.force_ocr)
            write_model(args.out / "document.json", document)
            extraction = extract_invoice(document, model=args.model)
            write_model(args.out / "extraction.json", extraction)
            write_model(args.out / "comparison.json", compare_invoice(extraction, snapshot))
    except (ValueError, OSError, ImportError) as exc:
        print(f"Processing failed: {exc}", file=sys.stderr)
        return 1
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
