/*
 * The look-alike sample POs, served from public/samples/ (copied from the importer package by
 * scripts/copy-samples.mjs). Fetched as bytes and staged like dropped files.
 */
export interface SampleFile {
  name: string;
  size: number;
}

export async function sampleIndex(): Promise<SampleFile[]> {
  try {
    const res = await fetch("/samples/index.json", { cache: "no-store" });
    return res.ok ? ((await res.json()) as SampleFile[]) : [];
  } catch {
    return [];
  }
}

/** The named sample PDFs (all of them when no names are given) as File objects. Missing ones are left out. */
export async function sampleFiles(names?: readonly string[]): Promise<File[]> {
  const want = names ?? (await sampleIndex()).map((s) => s.name);
  const files = await Promise.all(
    want.map(async (name) => {
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
