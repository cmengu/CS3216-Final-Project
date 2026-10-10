from typing import Any, Literal

from pydantic import BaseModel, Field


class Location(BaseModel):
    page: int = Field(ge=1)
    bbox: dict[str, Any] | None = None
    page_width: float | None = None
    page_height: float | None = None


class SourceBlock(BaseModel):
    id: str
    text: str
    locations: list[Location]


class PageRead(BaseModel):
    page_number: int
    extraction_method: Literal["embedded_text", "ocr", "mixed"]
    ocr_ran: bool
    embedded_characters: int
    ocr_cells: int
    markdown: str
    block_ids: list[str]
    warnings: list[str] = Field(default_factory=list)


class ParsedDocument(BaseModel):
    schema_version: Literal["1"] = "1"
    document_hash: str
    filename: str
    page_count: int
    reader_version: str
    markdown: str
    blocks: list[SourceBlock]
    pages: list[PageRead] = Field(default_factory=list)
    docling_document: dict[str, Any]
