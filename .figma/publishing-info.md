TAGLINE:
Browse, import, and version-sync icons from 150+ open source icon libraries.

DESCRIPTION:
**Iconsource** is a Figma plugin that lets you browse, preview, and import icons from open source icon libraries — Lucide, Phosphor, Tabler, Material Symbols, Feather, Heroicons, and 150+ more — directly into your document. Every icon it imports is tagged so you can keep it in sync as the source library releases new versions, without losing colours you've applied or breaking the node's identity.

## Features
**Search across 150+ open source icon libraries:** No per-library bundling or maintenance
**Preview before import:** See the icon, its source library, licence, and repo link before it touches your document
**Licence & repo transparency:** Every result shows which library it came from, its licence (with link), and a link to the source so you know what you're allowed to do with it
**Version-tracked imports:** Every icon Iconsource inserts is tagged with its source id and a content hash of the imported SVG
**Non-destructive updates:** "Check for Updates…" finds every Iconsource-imported icon in the document, compares it against the live version, and swaps the icon's paths in place for anything that's changed. The node itself (its id, position, size, and any fill colours you changed after import) is preserved; only the underlying geometry is replaced.


## Usage
1. **Plugins → Iconsource → Browse Icons…** — search, preview, and import icons onto the canvas
2. **Plugins → Iconsource → Check for Updates…** — lists every icon Iconsource has imported into the current document, flags any with a newer upstream version, and lets you update them individually


### How version tracking works
Every imported icon is tagged via Figma's node `pluginData` with the icon's source id, a hash of the inserted SVG, and (when available) the source collection's version string. "Check for Updates" re-fetches the live SVG for each tagged icon and compares hashes — if it differs, the update swaps only the icon's inner vector paths, never deletes and recreates the node, and best-effort reapplies any solid fills you'd customised, matched by path order.


Iconsource is open source, consider contributing. Code available on [GitHub](https://github.com/atropical/iconsource).

For bug reports, suggestions, or questions, please open an [issue](https://github.com/atropical/iconsource/issues).

Iconsource is able to search and fetch from so many libraries thanks to [Iconify](https://iconify.design), which aggregates them into one API.



TAGS:
icons, icon library, lucide, phosphor, tabler, material symbols, feather, heroicons, open source icons, svg, import icons, browse icons, version sync, design tokens, icon search, icon import, developer
