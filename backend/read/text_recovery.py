"""Preserve source text omitted by layout-based Markdown export; never infer new values."""

import re
import unicodedata
from collections.abc import Iterable


def _tokens(text: str) -> list[str]:
    return re.findall(r"\w+|[^\w\s|]", unicodedata.normalize("NFKC", text).casefold())


def recover_missing_text(markdown: str, sources: Iterable[str]) -> tuple[str, list[str]]:
    """Append missing source lines, deduplicating whitespace and Markdown table separators.

    Use contiguous token sequences rather than a bag of words: a missing amount or SKU
    must not be considered present merely because its individual characters occur elsewhere.
    The supplementary section is plain source text, not a reconstructed invoice table.
    """
    corpus = " " + " ".join(_tokens(markdown)) + " "
    missing = []
    for source in sources:
        for line in source.splitlines():
            line = line.strip()
            tokens = _tokens(line)
            if not tokens:
                continue
            needle = " " + " ".join(tokens) + " "
            if needle in corpus:
                continue
            missing.append(line)
            corpus += " ".join(tokens) + " "
    if not missing:
        return markdown, []
    return markdown + "\n\n### Recovered source text\n\n" + "\n".join(missing), missing
