import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("libarchive.js"));
const target = new URL("../public/archive/", import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ["worker-bundle.js", "libarchive.wasm"]) {
  await copyFile(join(source, file), new URL(file, target));
}
await copyFile(join(source, "../LICENSE"), new URL("LICENSE", target));
