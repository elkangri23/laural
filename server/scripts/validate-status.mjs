import { resolve } from "node:path";
import { readPublicStatus } from "../dist/server/src/public-status.js";

const statusPath = process.argv[2];
if (!statusPath) {
  console.error("Indica la ruta del archivo status.json que quieres validar.");
  process.exitCode = 2;
} else {
  try {
    await readPublicStatus(resolve(statusPath));
    console.log("Documento de estado válido.");
  } catch {
    console.error("Documento no válido o fuera de los límites. No se publica.");
    process.exitCode = 1;
  }
}
