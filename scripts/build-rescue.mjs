/**
 * Builds the one-shot tag-recovery plugin (src/rescue.ts) under an OLD
 * Iconsource plugin id, so it can read private plugin data written by a
 * build running under that id and copy it into shared plugin data.
 *
 *   node scripts/build-rescue.mjs [pluginId]
 *
 * Defaults to 1660068674953897925 (the id in use before fcb1b49). The other
 * candidate is 0000000000000000001 (the scaffold placeholder, pre-37b9096).
 * If one id recovers nothing, rebuild with the other and run it again.
 *
 * Output: dist-rescue/ — import it in Figma via Plugins > Development >
 * Import plugin from manifest, run it once per affected document, then
 * remove it. Never publish it, and don't leave it installed.
 */

import * as esbuild from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";

const DEFAULT_OLD_ID = "1660068674953897925";
const pluginId = process.argv[2] ?? DEFAULT_OLD_ID;
const outdir = "dist-rescue";

if (!/^\d+$/.test(pluginId)) {
  console.error(`Invalid plugin id: ${pluginId}`);
  process.exit(1);
}

mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: ["src/rescue.ts"],
  bundle: true,
  target: ["es6"],
  format: "iife",
  outfile: `${outdir}/code.js`,
});

writeFileSync(
  `${outdir}/manifest.json`,
  JSON.stringify(
    {
      name: "Iconsource Tag Recovery",
      id: pluginId,
      api: "1.0.0",
      main: "code.js",
      editorType: ["figma"],
      documentAccess: "dynamic-page",
      networkAccess: { allowedDomains: ["none"] },
    },
    null,
    2
  ) + "\n"
);

console.log(`Rescue build ready in ${outdir}/ (plugin id ${pluginId})`);
