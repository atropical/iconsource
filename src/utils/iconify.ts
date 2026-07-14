import { IconCollectionInfo, IconPreview, IconSearchResult } from "../types.d";

const API_BASE = "https://api.iconify.design";

/** In-memory cache for collection metadata (license/author/version) — cheap, small, reused across searches. */
const collectionCache = new Map<string, IconCollectionInfo>();

/**
 * Search icons across all Iconify collections. Iconify's own /search endpoint
 * already ranks by relevance, so results are used as returned.
 */
export async function searchIcons(query: string, limit = 64): Promise<IconSearchResult[]> {
  if (!query.trim()) return [];

  const res = await fetch(
    `${API_BASE}/search?query=${encodeURIComponent(query)}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`Icon search failed (${res.status})`);

  const data = await res.json() as { icons: string[] };
  return data.icons.map((icon) => {
    const [prefix, ...rest] = icon.split(":");
    return { icon, prefix, name: rest.join(":") };
  });
}

/**
 * Fetch metadata (name, author, license, total icons) for one or more
 * collections, caching results so repeated lookups for the same prefix
 * (e.g. many search hits from the same library) don't re-hit the network.
 */
export async function getCollectionInfo(prefix: string): Promise<IconCollectionInfo> {
  const cached = collectionCache.get(prefix);
  if (cached) return cached;

  const res = await fetch(`${API_BASE}/collections?prefix=${encodeURIComponent(prefix)}`);
  if (!res.ok) throw new Error(`Collection lookup failed (${res.status})`);

  const data = await res.json() as Record<string, {
    name: string;
    total: number;
    author: { name: string; url?: string };
    license: { title: string; spdx?: string; url?: string };
    version?: string;
  }>;

  const raw = data[prefix];
  if (!raw) throw new Error(`Unknown icon collection "${prefix}"`);

  const info: IconCollectionInfo = {
    prefix,
    name: raw.name,
    total: raw.total,
    author: raw.author,
    license: raw.license,
    repo: raw.author?.url,
    version: raw.version,
  };

  collectionCache.set(prefix, info);
  return info;
}

/** Fetch the raw SVG markup for one icon, ready to hand to figma.createNodeFromSvg. */
export async function getIconSvg(prefix: string, name: string): Promise<string> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`);
  if (!res.ok) throw new Error(`Icon "${prefix}:${name}" not found (${res.status})`);
  return res.text();
}

/** Resolve a search hit into a full preview: SVG body plus collection metadata. */
export async function resolveIconPreview(prefix: string, name: string): Promise<IconPreview> {
  const [svg, collection] = await Promise.all([
    getIconSvg(prefix, name),
    getCollectionInfo(prefix),
  ]);

  return { icon: `${prefix}:${name}`, prefix, name, svg, collection };
}
