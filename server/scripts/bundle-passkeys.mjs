import { build } from "esbuild";

await build({
  entryPoints: ["web/passkeys-client.ts"],
  outfile: "web/passkeys-client.js",
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
