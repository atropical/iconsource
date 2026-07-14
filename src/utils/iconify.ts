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
export async function getAllCollections(): Promise<Record<string, RawCollectionInfo>> {
  if (allCollectionsCache) return allCollectionsCache;

  const res = await fetch(`${API_BASE}/collections`);
  if (!res.ok) throw new Error(`Failed to load icon libraries (${res.status})`);

  allCollectionsCache = await res.json() as Record<string, RawCollectionInfo>;
  return allCollectionsCache;
}

/** A cheap, stable proxy for "has this library changed": its declared version (when Iconify has one) plus icon count. */
export function fingerprintFor(info: RawCollectionInfo): string {
  return `${info.version ?? "v0"}:${info.total}`;
}

// Trailing style suffixes Iconify uses to derive a sibling prefix from a
// base one, e.g. "material-symbols" -> "material-symbols-light". Grouping is
// driven by the *prefix*, not the display name: a candidate is only merged
// when stripping the suffix yields another prefix that actually exists in
// the dataset. This is what a purely name-based heuristic got wrong for
// libraries like Material Icons ("ic"), whose baseline/outline/round/sharp
// variants are separate *icon names* within one prefix, not sibling
// prefixes — so "ic" now correctly stays a single-style library instead of
// being misparsed from its display name. Longest phrases first so
// "extra-bold" matches before "bold".
const STYLE_SUFFIXES = [
  "extra-thin", "extra-bold", "extra-light", "two-tone", "sharp-filled",
  "semi-bold", "semibold", "duotone", "outlined", "rounded", "twotone",
  "filled", "regular", "outline", "duo", "thin", "light", "medium", "bold",
  "black", "fill", "round", "sharp", "solid", "line", "mini", "micro",
];

function titleCase(slug: string): string {
  return slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function splitPrefixAndStyle(prefix: string, prefixSet: Set<string>): { base: string; style: string } {
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
  const prefixSet = new Set(Object.keys(raw));
  const groups = new Map<string, { prefix: string; style: string; info: RawCollectionInfo }[]>();

  for (const [prefix, info] of Object.entries(raw)) {
    const { base, style } = splitPrefixAndStyle(prefix, prefixSet);
    const list = groups.get(base) ?? [];
    list.push({ prefix, style, info });
    groups.set(base, list);
  }

  return Array.from(groups.entries()).map(([base, entries]) => {
    const baseInfo = raw[base];
    const styles: LibraryStyle[] = entries
      .sort((a, b) => (a.style === "Default" ? -1 : b.style === "Default" ? 1 : a.style.localeCompare(b.style)))
      .map((e) => ({ prefix: e.prefix, label: e.style, total: e.info.total, version: e.info.version }));

    const totalIcons = entries.reduce((sum, e) => sum + e.info.total, 0);
    const sampleIcons = (baseInfo.samples ?? []).slice(0, 16).map((name) => `${base}:${name}`);

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
export async function getPrefixIndex(prefix: string): Promise<PrefixIndex> {
  const res = await fetch(`${API_BASE}/collection?prefix=${encodeURIComponent(prefix)}`);
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

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
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
  concurrency = 6
): Promise<IconData[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < names.length; i += chunkSize) chunks.push(names.slice(i, i + chunkSize));

  let fetched = 0;
  const out: IconData[] = [];

  await mapLimit(chunks, concurrency, async (chunk) => {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(prefix)}.json?icons=${chunk.map(encodeURIComponent).join(",")}`);
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
