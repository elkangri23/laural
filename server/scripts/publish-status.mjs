import { resolve } from "node:path";
import { publishPublicStatus } from "../dist/server/src/public-status.js";

const sourcePath = process.argv[2];
if (process.platform !== "linux") {
  console.error("La publicación del estado está limitada al VPS Linux.");
  process.exitCode = 1;
} else if (!sourcePath || process.argv.length !== 3) {
  console.error("Uso: npm run status:publish -- <archivo-status.json>");
  process.exitCode = 2;
} else {
  try {
    await publishPublicStatus(resolve(sourcePath), "/var/lib/laural/status/status.json");
    console.log("Estado público validado y publicado.");
  } catch {
    console.error("No se publicó el estado. Comprueba el JSON y los permisos del directorio.");
    process.exitCode = 1;
  }
}
