/*
 * The one door to the importer library (po-importer). Everything that reads, maps, checks or
 * writes rows comes from there; the app only shows, keeps and uses the rows. Pages and helpers
 * import from this module, never from "po-importer" directly, so the seam stays in one place.
 */
export {
  readPdf,
  toRows,
  validate,
  writeExcel,
  clipboardText,
  setManualValue,
  cellText,
  enqueueFiles,
  fileFingerprint,
  validatePdfFile,
  processEgcQueue,
  groupPoSheets,
  egcSheetKey,
  egcFileName,
  businessKey,
  linesHash,
  EGC_OUTPUT_COLUMNS,
} from "po-importer";

export type {
  ConfirmOrder,
  ConfirmPayload,
  EgcCell,
  EgcColumnDefinition,
  EgcColumnId,
  EgcCustomerAlias,
  EgcCustomerRecord,
  EgcFingerprints,
  EgcMasterData,
  EgcOrderSource,
  EgcOutputRow,
  EgcPdfResult,
  EgcProductAlias,
  EgcPurchaseOrder,
  EgcQueueStatus,
  EgcQueuedFile,
  EgcSkuRecord,
  EgcValidationIssue,
  EgcValidationResult,
} from "po-importer";

/**
 * The name staff see for the layout reader that read a PDF. The library returns only the
 * reader's id with a result; until it also exposes the reader's label, the id is shown.
 */
export function readerLabel(readerId: string): string {
  return readerId;
}

export type PasteResult = { status: "unavailable"; detail: string };

/**
 * Reads a pasted WhatsApp order. The library's readPaste is not published yet, so this
 * reports that reading pasted orders is not available.
 */
export async function readPastedOrder(text: string, customerId: string, deliveryDate: string): Promise<PasteResult> {
  void text;
  void customerId;
  void deliveryDate;
  return { status: "unavailable", detail: "Reading WhatsApp orders is not available yet" };
}
