export const INVOICE_ACCEPT = ".pdf,.xml,.zip,.rar,application/pdf,application/xml,text/xml,application/zip,application/x-zip-compressed,application/vnd.rar,application/x-rar-compressed";
export const MAX_INVOICE_BYTES = 20 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_BATCH_FILES = 500;
export const MAX_SELECTION_FILES = 10_000;
export const MAX_UPLOAD_BATCH_BYTES = 100 * 1024 * 1024;
export const isArchive = (name: string) => /\.(zip|rar)$/i.test(name);
