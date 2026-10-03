/*
 * The one door to the importer library (po-importer). Everything that reads, maps, checks or
 * writes rows comes from there; the app only shows, keeps and uses the rows. Pages and helpers
 * import from this module, never from "po-importer" directly, so the seam stays in one place.
 */
export {
  readPdf,
  readPaste,
  contentHash,
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
  EgcPasteResult,
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
 * reader's id with a result and does not export its readers' labels yet, so the labels are
 * written out here; an id not listed shows as itself.
 */
const READER_LABELS: Record<string, string> = {
  buynow: "Buynow",
  "shangri-la": "Shangri-La",
  "marriott-platform": "Hotel platform",
};
export const readerLabel = (readerId: string): string => READER_LABELS[readerId] ?? readerId;
