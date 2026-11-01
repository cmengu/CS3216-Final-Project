export const INVOICE_ACCEPT = ".pdf,.xml,.zip,.rar,application/pdf,application/xml,text/xml,application/zip,application/x-zip-compressed,application/vnd.rar,application/x-rar-compressed";
export const MAX_INVOICE_BYTES = 20 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const isArchive = (name: string) => /\.(zip|rar)$/i.test(name);
