/*
 * The look-alike sample POs, served from public/samples/ (copied from the importer package by
 * scripts/copy-samples.mjs). Which files they are is src/sample/sample-pos.json. Fetched as
 * bytes and staged like dropped files.
 */
import SAMPLE_POS from "@/sample/sample-pos.json";

/** The sample set's file names, in the order "use the four sample POs" queues them. */
export const SAMPLE_NAMES: readonly string[] = SAMPLE_POS.files;

/** The named sample PDFs (the whole set when no names are given) as File objects. Missing ones are left out. */
export async function sampleFiles(names: readonly string[] = SAMPLE_NAMES): Promise<File[]> {
  const files = await Promise.all(
    names.map(async (name) => {
      try {
        const res = await fetch(`/samples/${encodeURIComponent(name)}`, { cache: "no-store" });
        if (!res.ok) return null;
        return new File([await res.arrayBuffer()], name, { type: "application/pdf" });
      } catch {
        return null;
      }
    }),
  );
  return files.filter((f): f is File => f !== null);
}
