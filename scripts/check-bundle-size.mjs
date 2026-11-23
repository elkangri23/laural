import { readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_JAVASCRIPT_BUNDLE_BYTES = 500 * 1024;

export function oversizedBundles(bundles, maxBytes = MAX_JAVASCRIPT_BUNDLE_BYTES) {
  return bundles.filter((bundle) => bundle.bytes > maxBytes);
}

async function checkBuiltBundles() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const assetsDirectory = resolve(root, "dist", "assets");
  const entries = await readdir(assetsDirectory, { withFileTypes: true });
  const bundles = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map(async (entry) => ({ name: entry.name, bytes: (await stat(resolve(assetsDirectory, entry.name))).size })));

  if (bundles.length === 0) throw new Error("No se encontraron bundles JavaScript en dist/assets.");

  const oversized = oversizedBundles(bundles);
  if (oversized.length > 0) {
    for (const bundle of oversized) {
      console.error(`${bundle.name}: ${(bundle.bytes / 1024).toFixed(2)} KiB (máximo 500 KiB)`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`${bundles.length} bundles JavaScript dentro del límite de 500 KiB.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  checkBuiltBundles().catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo validar el tamaño de los bundles.");
    process.exitCode = 1;
  });
}
