"""Bind one immutable uploaded master snapshot before an invoice starts processing."""

from .csv_live import LiveStages, PriceSheet
from .master_list import current_master


class UploadedMasterStages:
    mode = "live"

    def __init__(self, *, model, client=None):
        if not model.strip():
            raise ValueError("Set OPENAI_MODEL for live extraction")
        self.model = model
        self.client = client

    def bind(self, store):
        document = current_master(store)
        if document is None:
            raise ValueError("Upload a master list before checking invoices.")
        return LiveStages(PriceSheet.from_master(document), model=self.model, client=self.client)
