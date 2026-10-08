const API_BASE = "https://api.iconify.design";
const MAX_BATCH = 80;
const RETRIES = 2;

interface RawIcon { body: string; width?: number; height?: number }
interface RawIconSet {
  icons?: Record<string, RawIcon>;
  aliases?: Record<string, { parent: string; width?: number; height?: number }>;
  width?: number;
  height?: number;
}

type Listener = (uri: string | null) => void;

// Resolved data: URIs (null = icon not found), keyed by "prefix:name".
const resolved = new Map<string, string | null>();
const listeners = new Map<string, Set<Listener>>();
const queued = new Map<string, Set<string>>();
let flushScheduled = false;

function toDataUri(icon: RawIcon, set: RawIconSet, width?: number, height?: number): string {
  const w = width ?? icon.width ?? set.width ?? 16;
  const h = height ?? icon.height ?? set.height ?? 16;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${icon.body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function resolveFromSet(set: RawIconSet, name: string): string | null {
  const direct = set.icons?.[name];
  if (direct) return toDataUri(direct, set);
  const alias = set.aliases?.[name];
  const parent = alias && set.icons?.[alias.parent];
  return parent ? toDataUri(parent, set, alias.width, alias.height) : null;
}

function settle(key: string, uri: string | null) {
  resolved.set(key, uri);
  listeners.get(key)?.forEach((fn) => fn(uri));
  listeners.delete(key);
}

async function fetchBatch(prefix: string, names: string[]) {
  const url = `${API_BASE}/${prefix}.json?icons=${names.map(encodeURIComponent).join(",")}`;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const set = await res.json() as RawIconSet;
      names.forEach((name) => settle(`${prefix}:${name}`, resolveFromSet(set, name)));
      return;
    } catch {
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  // Leave failed icons unresolved so a later mount can try again.
  names.forEach((name) => {
    const key = `${prefix}:${name}`;
    listeners.get(key)?.forEach((fn) => fn(null));
    listeners.delete(key);
  });
}

function flush() {
  flushScheduled = false;
  const batches = [...queued.entries()];
  queued.clear();
  for (const [prefix, nameSet] of batches) {
    const names = [...nameSet];
    for (let i = 0; i < names.length; i += MAX_BATCH) {
      void fetchBatch(prefix, names.slice(i, i + MAX_BATCH));
    }
  }
}

/**
 * Loads an icon's SVG as a data: URI. Requests made in the same tick are
 * grouped into one JSON call per icon set, and the SVG is built locally, so
 * nothing passes through CSS url() loading (which enforces CORS and can get
 * stuck on a bad cached response).
 */
export function loadIconSvg(icon: string, listener: Listener): () => void {
  if (resolved.has(icon)) {
    listener(resolved.get(icon)!);
    return () => {};
  }

  const subs = listeners.get(icon) ?? new Set<Listener>();
  const isNew = subs.size === 0;
  subs.add(listener);
  listeners.set(icon, subs);

  if (isNew) {
    const [prefix, name] = icon.split(":");
    const names = queued.get(prefix) ?? new Set<string>();
    names.add(name);
    queued.set(prefix, names);
    if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(flush, 0);
    }
  }

  return () => { listeners.get(icon)?.delete(listener); };
}

export function getCachedIconSvg(icon: string): string | null | undefined {
  return resolved.get(icon);
}
