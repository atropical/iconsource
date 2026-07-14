import * as esbuild from "esbuild";

esbuild
  .build({
    entryPoints: ["src/**.ts"],
    bundle: true,
    outdir: "./dist",
    target: ["es6"],
    format: "iife",
    plugins: [],
  })
  .catch(() => process.exit(1));
