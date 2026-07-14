import { IconData, IconLibrary, IconSearchResult, LibraryStyle } from "../types.d";

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

// Trailing style words Iconify collection names commonly use to distinguish
// sibling prefixes of the same underlying library (e.g. "Phosphor" / "Phosphor
// Bold" / "Phosphor Duotone"). Longest phrases first so "Extra Bold" matches
// before "Bold".
const STYLE_WORDS = [
  "Extra Thin", "Extra Bold", "Extra Light", "Two Tone", "Sharp Filled",
  "Semi Bold", "Semibold", "Duotone", "Outlined", "Rounded", "Twotone",
  "Filled", "Regular", "Outline", "Duo", "Thin", "Light", "Medium", "Bold",
  "Black", "Fill", "Round", "Sharp", "Solid", "Line", "Mini", "Micro",
];

function splitNameAndStyle(name: string): { base: string; style: string } {
  for (const word of STYLE_WORDS) {
    const suffix = new RegExp(`\\s+${word}$`, "i");
    if (suffix.test(name)) {
      return { base: name.replace(suffix, "").trim(), style: word };
    }
  }
  return { base: name, style: "Default" };
}

/**
 * Group Iconify's flat prefix list into browsable "libraries": sibling
 * prefixes that share a base name and author (e.g. all of Phosphor's five
 * styles) collapse into one entry with multiple `styles`.
 */
export function groupLibraries(raw: Record<string, RawCollectionInfo>): IconLibrary[] {
  const groups = new Map<string, { base: string; author: RawCollectionInfo["author"]; license: RawCollectionInfo["license"]; entries: { prefix: string; style: string; info: RawCollectionInfo }[] }>();

  for (const [prefix, info] of Object.entries(raw)) {
    const { base, style } = splitNameAndStyle(info.name);
    const key = `${info.author?.name ?? ""}::${base}`;
    let group = groups.get(key);
    if (!group) {
      group = { base, author: info.author, license: info.license, entries: [] };
      groups.set(key, group);
    }
    group.entries.push({ prefix, style, info });
  }

  return Array.from(groups.values()).map((group) => {
    const styles: LibraryStyle[] = group.entries
      .sort((a, b) => a.style.localeCompare(b.style))
      .map((e) => ({ prefix: e.prefix, label: e.style, total: e.info.total, version: e.info.version }));

    const first = group.entries[0];
    const totalIcons = group.entries.reduce((sum, e) => sum + e.info.total, 0);
    const sampleIcons = (first.info.samples ?? []).slice(0, 6).map((name) => `${first.prefix}:${name}`);

    return {
      id: `${group.author?.name ?? "unknown"}:${group.base}`,
      displayName: group.base,
      author: group.author,
      license: group.license,
      repo: group.author?.url,
      styles,
      totalIcons,
      sampleIcons,
    };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Search icons within a single library style (prefix). Requires a non-empty query — Iconify's search endpoint doesn't support browsing with no term. */
export async function searchIconsInPrefix(prefix: string, query: string, limit = 200): Promise<IconSearchResult[]> {
  const res = await fetch(`${API_BASE}/search?query=${encodeURIComponent(query)}&prefixes=${encodeURIComponent(prefix)}&limit=${limit}`);
  if (!res.ok) throw new Error(`Icon search failed (${res.status})`);

  const data = await res.json() as { icons: string[] };
  return data.icons.map((icon) => {
    const [, ...rest] = icon.split(":");
    return { icon, prefix, name: rest.join(":") };
  });
}

/** First page of icon names in a style, for browsing before the user has typed a search — cheap, names only. */
export async function browseIconsInPrefix(prefix: string, limit = 120): Promise<IconSearchResult[]> {
  const names = await listAllIconsInPrefix(prefix);
  return names.slice(0, limit).map((name) => ({ icon: `${prefix}:${name}`, prefix, name }));
}

/** List every icon name in a style (prefix), for "import entire library". */
export async function listAllIconsInPrefix(prefix: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/collection?prefix=${encodeURIComponent(prefix)}`);
  if (!res.ok) throw new Error(`Failed to list icons for "${prefix}" (${res.status})`);

  const data = await res.json() as {
    uncategorized?: string[];
    categories?: Record<string, string[]>;
  };

  const names = new Set<string>(data.uncategorized ?? []);
  for (const list of Object.values(data.categories ?? {})) {
    for (const name of list) names.add(name);
  }
  return Array.from(names);
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
