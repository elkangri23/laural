import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/shared", { recursive: true });
await mkdir("dist/server/migrations", { recursive: true });
await cp("../shared/preference-snapshot-v1.schema.json", "dist/shared/preference-snapshot-v1.schema.json");
await cp("migrations", "dist/server/migrations", { recursive: true });
