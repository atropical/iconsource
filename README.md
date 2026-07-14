# Icontopia — Figma Icon Library Plugin

Icontopia lets you browse, preview, and import icons from open source icon libraries (Lucide, Phosphor, Tabler, Material Symbols, Feather, Heroicons, and 150+ more via [Iconify](https://iconify.design)) directly into Figma — then keep them in sync as those libraries release new versions, without losing colours you've applied or breaking the node's identity.

## Features

- **Search across 150+ open source icon libraries** via the Iconify API — no per-library bundling or maintenance
- **Preview before import**: see the icon, its source library, licence, and repo link before it touches your document
- **License & repo transparency**: every result shows which library it came from, its licence (with link), and a link to the source so you know what you're allowed to do with it
- **Version-tracked imports**: every icon Icontopia inserts is tagged with its source id and a content hash of the imported SVG
- **Non-destructive updates**: "Check for Updates…" finds every Icontopia-imported icon in the document, compares it against the live version, and — for anything that's changed — swaps the icon's paths in place. The node itself (its id, position, size, and any fill colours you changed after import) is preserved; only the underlying geometry is replaced.

## Usage

1. **Plugins → Icontopia → Browse Icons…** — search, preview, and import icons onto the canvas
2. **Plugins → Icontopia → Check for Updates…** — lists every icon Icontopia has imported into the current document, flags any with a newer upstream version, and lets you update them individually

## How version tracking works

Every imported icon is tagged via Figma's node `pluginData` with:

- `icontopia:icon` — the Iconify icon id (`<prefix>:<name>`)
- `icontopia:svgHash` — a hash of the SVG that was actually inserted
- `icontopia:version` — the source collection's version string, when Iconify exposes one (informational; the hash is what drives update detection)

"Check for Updates" re-fetches the live SVG for each tagged icon and compares hashes. If it differs, the update swaps only the icon's inner vector paths — it never deletes and recreates the node — and best-effort reapplies any solid fills you'd customised, matched by path order.

## Development

```
npm install
npm run dev
```

Then import `manifest.json` into Figma as a local plugin (Plugins → Development → Import plugin from manifest…).

### Building for production

```
npm run build
```

## Author

Icontopia is developed and maintained by [Atropical AS](https://atropical.no).
