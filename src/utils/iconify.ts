import { IconData, IconLibrary, LibraryStyle } from "../types.d";

const API_BASE = "https://api.iconify.design";

interface RawCollectionInfo {
  name: string;
  total: number;
  author: { name: string; url?: string };
  license: { title: string; spdx?: string; url?: string };
  samples?: string[];
  version?: string;
}

let allCollectionsCache: Record<string, RawCollectionInfo> | null = null;

/** Fetch metadata for every Iconify collection in one call. Cached for the session — this is the data the library browser and update fingerprints are built from. */
export async function getAllCollections(signal?: AbortSignal): Promise<Record<string, RawCollectionInfo>> {
  if (allCollectionsCache) return allCollectionsCache;

  const res = await fetch(`${API_BASE}/collections`, { signal });
  if (!res.ok) throw new Error(`Failed to load icon libraries (${res.status})`);

  allCollectionsCache = await res.json() as Record<string, RawCollectionInfo>;
  return allCollectionsCache;
}

/** A cheap, stable proxy for "has this library changed": its declared version (when Iconify has one) plus icon count. */
export function fingerprintFor(info: RawCollectionInfo): string {
  return `${info.version ?? "v0"}:${info.total}`;
}

// Trailing style suffixes Iconify uses to derive a sibling prefix from a
// base one, e.g. "material-symbols" -> "material-symbols-light". Verified
// against a live pull of api.iconify.design/collections (2026-07): every
// entry here is an actual suffix pattern found across real sibling prefixes
// — e.g. icon-park/-outline/-solid/-twotone, fluent-emoji/-flat/-high-contrast,
// devicon/-plain, emojione/-monotone, and the streamline-<theme>/-color family.
// Grouping is driven by the *prefix*, not the display name: a candidate is
// only merged when stripping the suffix yields another prefix that actually
// exists in the dataset. This is what a purely name-based heuristic got
// wrong for libraries like classic Material Icons ("ic"), whose
// baseline/outline/round/sharp variants are separate *icon names* within
// one prefix, not sibling prefixes — there's no "ic-outline" collection to
// find, so no amount of suffix-list tuning groups it; see getStyleClusters
// in LibraryDetailView for how that class of library is handled instead.
// Longest phrases first so "extra-bold" matches before "bold".
const STYLE_SUFFIXES = [
  "extra-thin", "extra-bold", "extra-light", "two-tone", "sharp-filled",
  "semi-bold", "semibold", "high-contrast", "baseline", "duotone",
  "outlined", "rounded", "twotone", "monotone", "filled", "regular",
  "outline", "duo", "thin", "light", "medium", "bold", "black", "fill",
  "round", "sharp", "solid", "line", "mini", "micro", "color", "flat",
  "plain",
];

// A handful of real libraries split into sibling prefixes that share no
// common *existing* base prefix (e.g. Font Awesome 6 is "fa6-solid" /
// "fa6-regular" / "fa6-brands" — there is no bare "fa6" collection), so the
// suffix-stripping heuristic above has nothing to anchor to. Verified against
// the live collections list (2026-07); each version of Font Awesome is kept
// as its own group rather than merged across versions.
const PREFIX_OVERRIDES: Record<string, { base: string; baseName: string; style: string }> = {
  "fa-solid": { base: "fa", baseName: "Font Awesome 5", style: "Solid" },
  "fa-regular": { base: "fa", baseName: "Font Awesome 5", style: "Regular" },
  "fa-brands": { base: "fa", baseName: "Font Awesome 5", style: "Brands" },
  "fa6-solid": { base: "fa6", baseName: "Font Awesome 6", style: "Solid" },
  "fa6-regular": { base: "fa6", baseName: "Font Awesome 6", style: "Regular" },
  "fa6-brands": { base: "fa6", baseName: "Font Awesome 6", style: "Brands" },
  "fa7-solid": { base: "fa7", baseName: "Font Awesome 7", style: "Solid" },
  "fa7-regular": { base: "fa7", baseName: "Font Awesome 7", style: "Regular" },
  "fa7-brands": { base: "fa7", baseName: "Font Awesome 7", style: "Brands" },
};

function titleCase(slug: string): string {
  return slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function splitPrefixAndStyle(prefix: string, prefixSet: Set<string>): { base: string; style: string } {
  const override = PREFIX_OVERRIDES[prefix];
  if (override) return { base: override.base, style: override.style };

  for (const suffix of STYLE_SUFFIXES) {
    if (prefix.endsWith(`-${suffix}`)) {
      const base = prefix.slice(0, -(suffix.length + 1));
      if (prefixSet.has(base)) {
        return { base, style: titleCase(suffix) };
      }
    }
  }
  return { base: prefix, style: "Default" };
}

// Iconify's public API doesn't expose download/popularity stats, so "popular
// first" is approximated with a fixed ranking of well-known open source icon
// sets. Everything else falls back to alphabetical.
const POPULAR_PREFIXES = [
  "lucide", "material-symbols", "mdi", "ph", "tabler", "heroicons",
  "ion", "bi", "fa6-solid", "fa6-regular", "feather", "carbon", "ic",
  "akar-icons", "iconoir", "solar", "streamline", "octicon", "ri",
  "fluent", "eva", "la",
];

function popularityRank(id: string): number {
  const i = POPULAR_PREFIXES.indexOf(id);
  return i === -1 ? POPULAR_PREFIXES.length : i;
}

/**
 * Group Iconify's flat prefix list into browsable "libraries": sibling
 * prefixes that share a base prefix (e.g. all of Phosphor's five styles)
 * collapse into one entry with multiple `styles`.
 */
export function groupLibraries(raw: Record<string, RawCollectionInfo>): IconLibrary[] {
  // Virtual bases from PREFIX_OVERRIDES (e.g. "fa6") don't exist as real
  // collections — synthesize a stand-in using the first sibling's
  // author/license/samples so the group still has something to display.
  const prefixSet = new Set(Object.keys(raw));
  for (const override of Object.values(PREFIX_OVERRIDES)) {
    if (!prefixSet.has(override.base)) prefixSet.add(override.base);
  }

  const groups = new Map<string, { prefix: string; style: string; info: RawCollectionInfo }[]>();

  for (const [prefix, info] of Object.entries(raw)) {
    const { base, style } = splitPrefixAndStyle(prefix, prefixSet);
    const list = groups.get(base) ?? [];
    list.push({ prefix, style, info });
    groups.set(base, list);
  }

  return Array.from(groups.entries()).map(([base, entries]) => {
    // Pick the sibling to source samples/metadata from *before* sorting for
    // display below (that sort is alphabetical by style label, which for a
    // family like Font Awesome 6 would put "Brands" first — and a logo-only
    // style's `samples` names aren't valid icons in a sibling like
    // "-solid"/"-regular" either way, so avoid it when a normal-icon style
    // exists to source from instead).
    const sampleEntry = entries.find((e) => e.style !== "Brands") ?? entries[0];
    const baseInfo: RawCollectionInfo = raw[base] ?? {
      ...sampleEntry.info,
      name: PREFIX_OVERRIDES[sampleEntry.prefix]?.baseName ?? sampleEntry.info.name,
    };
    const styles: LibraryStyle[] = entries
      .sort((a, b) => (a.style === "Default" ? -1 : b.style === "Default" ? 1 : a.style.localeCompare(b.style)))
      .map((e) => ({ prefix: e.prefix, label: e.style, total: e.info.total, version: e.info.version }));

    const totalIcons = entries.reduce((sum, e) => sum + e.info.total, 0);
    // Samples must be namespaced under a prefix that's actually fetchable —
    // "base" itself may be a synthesized virtual id (see PREFIX_OVERRIDES)
    // that doesn't exist as a real collection.
    const samplePrefix = raw[base] ? base : sampleEntry.prefix;
    const sampleIcons = (baseInfo.samples ?? []).slice(0, 16).map((name) => `${samplePrefix}:${name}`);

    return {
      id: base,
      displayName: baseInfo.name,
      author: baseInfo.author,
      license: baseInfo.license,
      repo: baseInfo.author?.url,
      styles,
      totalIcons,
      sampleIcons,
    };
  }).sort((a, b) => popularityRank(a.id) - popularityRank(b.id) || a.displayName.localeCompare(b.displayName));
}

export interface PrefixIndex {
  names: string[];
  categoryByName: Map<string, string>;
  categories: string[];
}

/**
 * Full icon-name index for one style, with category labels — loaded once
 * per style so search, category filtering, sorting, and pagination can all
 * happen client-side instead of round-tripping to Iconify per keystroke.
 */
export async function getPrefixIndex(prefix: string, signal?: AbortSignal): Promise<PrefixIndex> {
  const res = await fetch(`${API_BASE}/collection?prefix=${encodeURIComponent(prefix)}`, { signal });
  if (!res.ok) throw new Error(`Failed to list icons for "${prefix}" (${res.status})`);

  const data = await res.json() as {
    uncategorized?: string[];
    categories?: Record<string, string[]>;
  };

  const categoryByName = new Map<string, string>();
  for (const [category, list] of Object.entries(data.categories ?? {})) {
    for (const name of list) categoryByName.set(name, category);
  }
  for (const name of data.uncategorized ?? []) {
    if (!categoryByName.has(name)) categoryByName.set(name, "Uncategorized");
  }

  return {
    names: Array.from(categoryByName.keys()),
    categoryByName,
    categories: Object.keys(data.categories ?? {}).sort((a, b) => a.localeCompare(b)),
  };
}

/** List every icon name in a style (prefix), for "import entire library". */
export async function listAllIconsInPrefix(prefix: string): Promise<string[]> {
  return (await getPrefixIndex(prefix)).names;
}

export interface NameStyleClusters {
  styleByName: Map<string, string>;
  styles: string[];
}

interface NameStyleRule {
  label: string;
  pattern: RegExp;
}

// Explicit, individually-verified style rules for popular libraries whose
// variants live inside the icon name rather than as separate Iconify
// prefixes. The generic word-list heuristic below gets some of these
// actively *wrong* — checked against live icon-name data (2026-07):
//   - Solar's real styles are "Bold Duotone" and "Line Duotone" (compound),
//     not a generic "Duotone" — the generic matcher would merge both into
//     one bucket and lose the distinction.
//   - Tabler's "-off" suffix (520 icons, e.g. "wifi-off") clears the
//     generic 5% share threshold but isn't a style at all — it's a
//     different icon. Only "-filled" (1053 icons) is a real second style.
//   - Heroicons packs two axes into one suffix (outline/solid × size), so a
//     single trailing-word match can't separate "24px solid" from
//     "20px solid" (Mini) from "16px solid" (Micro) correctly.
// Rules run in order, first match wins — compound patterns are listed
// before the shorter ones they'd otherwise be swallowed by. `defaultLabel`
// covers everything left over: real repo docs confirm these libraries all
// treat the unsuffixed name as one specific default style, not "uncategorized".
const HARDCODED_NAME_STYLES: Record<string, { rules: NameStyleRule[]; defaultLabel: string }> = {
  ic: {
    rules: [
      { label: "Baseline", pattern: /^baseline-/i },
      { label: "Outline", pattern: /^outline-/i },
      { label: "Round", pattern: /^round-/i },
      { label: "Sharp", pattern: /^sharp-/i },
      { label: "Twotone", pattern: /^twotone-/i },
    ],
    defaultLabel: "Baseline",
  },
  ph: {
    rules: [
      { label: "Thin", pattern: /-thin$/i },
      { label: "Light", pattern: /-light$/i },
      { label: "Bold", pattern: /-bold$/i },
      { label: "Fill", pattern: /-fill$/i },
      { label: "Duotone", pattern: /-duotone$/i },
    ],
    defaultLabel: "Regular",
  },
  solar: {
    rules: [
      { label: "Bold Duotone", pattern: /-bold-duotone$/i },
      { label: "Line Duotone", pattern: /-line-duotone$/i },
      { label: "Bold", pattern: /-bold$/i },
      { label: "Broken", pattern: /-broken$/i },
      { label: "Linear", pattern: /-linear$/i },
      { label: "Outline", pattern: /-outline$/i },
    ],
    defaultLabel: "Linear",
  },
  heroicons: {
    rules: [
      { label: "Micro (16, Solid)", pattern: /-16-solid$/i },
      { label: "Mini (20, Solid)", pattern: /-20-solid$/i },
      { label: "Solid", pattern: /-solid$/i },
    ],
    defaultLabel: "Outline",
  },
  ion: {
    rules: [
      { label: "Outline", pattern: /-outline$/i },
      { label: "Sharp", pattern: /-sharp$/i },
    ],
    defaultLabel: "Filled",
  },
  ri: {
    rules: [
      { label: "Fill", pattern: /-fill$/i },
      { label: "Line", pattern: /-line$/i },
    ],
    defaultLabel: "Line",
  },
  fluent: {
    rules: [
      { label: "Filled", pattern: /-filled$/i },
      { label: "Regular", pattern: /-regular$/i },
    ],
    defaultLabel: "Regular",
  },
  tabler: {
    rules: [
      { label: "Filled", pattern: /-filled$/i },
    ],
    defaultLabel: "Outline",
  },
};

const NAME_STYLE_SUFFIX_RE = new RegExp(`[-_](${STYLE_SUFFIXES.join("|")})$`, "i");
// Some libraries put the style first instead — classic Material Icons names
// like "baseline-home" / "outline-home" / "round-home", not "home-outline".
const NAME_STYLE_PREFIX_RE = new RegExp(`^(${STYLE_SUFFIXES.join("|")})[-_]`, "i");
const NAME_STYLE_MIN_COVERAGE = 0.3;
// A suffix only counts as a real style — not an icon that incidentally ends
// in that word (e.g. Phosphor's "house-line" or "battery-medium" aren't
// "Line"/"Medium" weight variants) — if it's genuinely systematic: shared by
// a real fraction of the collection, not a handful of one-off names.
const NAME_STYLE_MIN_SHARE = 0.05;

/**
 * Some libraries (classic Material Icons "ic", Ionicons "ion", Bootstrap
 * Icons "bi", and — it turns out — Phosphor "ph", whose 6 weights all live
 * in one Iconify prefix too) have no sibling style prefixes at all — their
 * variants are separate *icon names* within one collection (e.g. "house" /
 * "house-bold" / "house-duotone"). groupLibraries can't split these
 * (there's nothing to split — see its comment), so this runs client-side on
 * the already-loaded name index to detect the same pattern at the name
 * level instead, for a "style" filter scoped to one library.
 *
 * For popular libraries, a verified rule set from HARDCODED_NAME_STYLES is
 * used instead of guessing — hand-checked against real icon-name data, so
 * it can't misfire the way a generic word match can. Everything else falls
 * through to the generic heuristic below, gated by two thresholds so it
 * doesn't fire on noise: a suffix must cover a real share of the
 * collection (not a few incidental names), and after that, the surviving
 * suffixes together must still cover a real share of all names and have at
 * least two distinct styles.
 */
export function detectNameStyles(names: string[], prefix?: string): NameStyleClusters | null {
  if (names.length === 0) return null;

  const hardcoded = prefix ? HARDCODED_NAME_STYLES[prefix] : undefined;
  if (hardcoded) {
    const styleByName = new Map<string, string>();
    for (const name of names) {
      const rule = hardcoded.rules.find((r) => r.pattern.test(name));
      styleByName.set(name, rule?.label ?? hardcoded.defaultLabel);
    }
    const styles = Array.from(new Set(styleByName.values())).sort((a, b) => a.localeCompare(b));
    return styles.length >= 2 ? { styleByName, styles } : null;
  }

  const rawMatches = new Map<string, string>();
  const countBySuffix = new Map<string, number>();
  for (const name of names) {
    const match = name.match(NAME_STYLE_SUFFIX_RE) ?? name.match(NAME_STYLE_PREFIX_RE);
    if (!match) continue;
    const suffix = match[1].toLowerCase();
    rawMatches.set(name, suffix);
    countBySuffix.set(suffix, (countBySuffix.get(suffix) ?? 0) + 1);
  }

  const minCount = names.length * NAME_STYLE_MIN_SHARE;
  const keptSuffixes = new Set(
    Array.from(countBySuffix.entries()).filter(([, count]) => count >= minCount).map(([s]) => s)
  );

  const styleByName = new Map<string, string>();
  for (const [name, suffix] of rawMatches) {
    if (keptSuffixes.has(suffix)) styleByName.set(name, titleCase(suffix));
  }

  if (styleByName.size / names.length < NAME_STYLE_MIN_COVERAGE) return null;

  const styles = Array.from(new Set(styleByName.values())).sort((a, b) => a.localeCompare(b));
  if (styles.length < 2) return null;

  return { styleByName, styles };
}

interface IconifyBulkResponse {
  prefix: string;
  width?: number;
  height?: number;
  icons: Record<string, { body: string; width?: number; height?: number }>;
  not_found?: string[];
}

function buildSvg(body: string, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Fetch SVG bodies for many icons in one library style, using Iconify's bulk
 * JSON endpoint (one request covers up to `chunkSize` icons, far cheaper
 * than fetching each icon's .svg individually). Used for both "import
 * search results" and "import entire library".
 */
export async function fetchIconData(
  prefix: string,
  names: string[],
  onProgress?: (fetched: number, total: number) => void,
  chunkSize = 50,
  concurrency = 6,
  signal?: AbortSignal
): Promise<IconData[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < names.length; i += chunkSize) chunks.push(names.slice(i, i + chunkSize));

  let fetched = 0;
  const out: IconData[] = [];

  await mapLimit(chunks, concurrency, async (chunk) => {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(prefix)}.json?icons=${chunk.map(encodeURIComponent).join(",")}`, { signal });
    if (!res.ok) throw new Error(`Failed to fetch icons for "${prefix}" (${res.status})`);

    const data = await res.json() as IconifyBulkResponse;
    const defaultWidth = data.width ?? 16;
    const defaultHeight = data.height ?? 16;

    for (const name of chunk) {
      const icon = data.icons[name];
      if (!icon) continue;
      out.push({
        icon: `${prefix}:${name}`,
        prefix,
        name,
        svg: buildSvg(icon.body, icon.width ?? defaultWidth, icon.height ?? defaultHeight),
      });
    }

    fetched += chunk.length;
    onProgress?.(Math.min(fetched, names.length), names.length);
  });

  return out;
}
