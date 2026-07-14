/// <reference types="@figma/plugin-typings" />

/**
 * Node tagging + version-safe replace for imported icons. Runs on the plugin
 * main thread (has document access, no DOM). Every icon Icontopia inserts is
 * tagged via pluginData so a later "check for updates" pass can find it,
 * compare it against the live Iconify SVG, and swap geometry in place
 * without deleting/recreating the node — preserving its id, position, size,
 * and any fill colours the user applied after import.
 */

const NS = "icontopia";
const KEY_ICON = `${NS}:icon`; // "<prefix>:<name>"
const KEY_HASH = `${NS}:svgHash`;
const KEY_VERSION = `${NS}:version`;

/** Cheap, deterministic string hash (djb2) — good enough for change detection, not a security primitive. */
export function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export interface IconTag {
  icon: string;
  prefix: string;
  name: string;
  svgHash: string;
  version?: string;
}

export function readIconTag(node: SceneNode): IconTag | null {
  const icon = node.getPluginData(KEY_ICON);
  const svgHash = node.getPluginData(KEY_HASH);
  if (!icon || !svgHash) return null;

  const [prefix, ...rest] = icon.split(":");
  const version = node.getPluginData(KEY_VERSION);

  return { icon, prefix, name: rest.join(":"), svgHash, version: version || undefined };
}

function tagIconNode(node: SceneNode, icon: string, svgHash: string, version?: string): void {
  node.setPluginData(KEY_ICON, icon);
  node.setPluginData(KEY_HASH, svgHash);
  node.setPluginData(KEY_VERSION, version ?? "");
}

/** Insert a freshly fetched icon SVG into the current page, tagged for future update checks. */
export function insertIcon(svg: string, icon: string, version?: string): SceneNode {
  const node = figma.createNodeFromSvg(svg);
  node.name = icon;

  const viewport = figma.viewport.center;
  node.x = viewport.x - node.width / 2;
  node.y = viewport.y - node.height / 2;

  figma.currentPage.appendChild(node);
  tagIconNode(node, icon, hashString(svg), version);
  figma.currentPage.selection = [node];

  return node;
}

/** Recursively find every node on every page tagged as an Icontopia-imported icon. */
export function findTrackedNodes(): SceneNode[] {
  const found: SceneNode[] = [];

  const walk = (node: BaseNode) => {
    if ("getPluginData" in node && readIconTag(node as SceneNode)) {
      found.push(node as SceneNode);
      return; // don't descend into an icon's own internals looking for nested tags
    }
    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) walk(child);
    }
  };

  for (const page of figma.root.children) walk(page);
  return found;
}

/** Solid fills on an icon's direct vector/path children, captured by traversal order, for reapplication after a geometry swap. */
type FillSnapshot = Paint[][];

function collectPaintableDescendants(node: SceneNode): (VectorNode | StarNode | EllipseNode | PolygonNode | RectangleNode)[] {
  const result: (VectorNode | StarNode | EllipseNode | PolygonNode | RectangleNode)[] = [];
  const walk = (n: SceneNode) => {
    if ("fills" in n) result.push(n as VectorNode);
    if ("children" in n) for (const child of (n as unknown as ChildrenMixin).children) walk(child as SceneNode);
  };
  walk(node);
  return result;
}

function captureFills(node: SceneNode): FillSnapshot {
  return collectPaintableDescendants(node).map((n) =>
    Array.isArray(n.fills) ? n.fills.map((f) => ({ ...f })) : []
  );
}

function applyFills(node: SceneNode, snapshot: FillSnapshot): void {
  const targets = collectPaintableDescendants(node);
  // Best-effort: reapply by traversal-order index. Most icon sets keep a
  // stable path order between versions, so this holds for the common case;
  // when the shape count differs, only the matching prefix is restored and
  // the rest keep the freshly imported SVG's original fill.
  for (let i = 0; i < Math.min(targets.length, snapshot.length); i++) {
    targets[i].fills = snapshot[i];
  }
}

export interface UpdateResult {
  node: SceneNode;
  changed: boolean;
}

/**
 * Replace an already-imported icon's geometry with a newer SVG, truly in
 * place: the outer node Icontopia inserted keeps its id (so selection,
 * prototype links, dev-mode comments, etc. pinned to it survive), only its
 * inner vector paths are swapped. User-applied colours are captured before
 * the swap and reapplied by traversal order afterwards.
 */
export function updateIconNode(existing: SceneNode, newSvg: string, icon: string, version?: string): UpdateResult {
  const newHash = hashString(newSvg);
  const tag = readIconTag(existing);
  if (tag && tag.svgHash === newHash) {
    return { node: existing, changed: false };
  }

  if (!("children" in existing)) {
    throw new Error("Tracked icon node has no children to replace — was it modified outside Icontopia?");
  }

  const fills = captureFills(existing);
  const container = existing as unknown as ChildrenMixin & SceneNode;

  // figma.createNodeFromSvg appends its result to the current page as a
  // scratch node; its children get moved into the existing node, then it's
  // discarded.
  const scratch = figma.createNodeFromSvg(newSvg);
  const newWidth = scratch.width;
  const newHeight = scratch.height;

  for (const child of [...container.children]) child.remove();
  for (const child of [...(scratch as unknown as ChildrenMixin).children]) {
    container.appendChild(child);
  }
  scratch.remove();

  if ("resize" in existing) (existing as LayoutMixin).resize(newWidth, newHeight);

  applyFills(existing, fills);
  tagIconNode(existing, icon, newHash, version);
  figma.currentPage.selection = [existing];

  return { node: existing, changed: true };
}
