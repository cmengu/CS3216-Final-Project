"""Person 3's processing module; no database, HTTP server, or browser dependencies."""

from .comparator import compare_invoice
from .schemas import Extraction, MasterSnapshot

__all__ = ["Extraction", "MasterSnapshot", "compare_invoice"]
