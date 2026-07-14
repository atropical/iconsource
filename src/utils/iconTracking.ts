/// <reference types="@figma/plugin-typings" />

/**
 * Node tagging + version-safe replace for imported icons. Runs on the plugin
 * main thread (has document access, no DOM). Every icon Icontopia inserts is
 * tagged via pluginData so a later "check for updates" pass can find it,
 * compare it against the live Iconify SVG, and swap geometry in place
 * without deleting/recreating the node — preserving its id, position, size,
 * and any fill colours the user applied after import.
 *
 * Sync is scoped per library style (Iconify prefix): every icon imported
 * from the same style shares one `libraryFingerprint` (see
 * utils/iconify.ts's fingerprintFor), so "check for updates" only needs one
 * cheap collection-metadata lookup per style, not one per icon.
 */

interface IconInput {
  icon: string;
  prefix: string;
  name: string;
  svg: string;
}

const NS = "icontopia";
const KEY_ICON = `${NS}:icon`; // "<prefix>:<name>"
const KEY_HASH = `${NS}:svgHash`;
const KEY_FINGERPRINT = `${NS}:libraryFingerprint`;

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
  libraryFingerprint: string;
}

export function readIconTag(node: SceneNode): IconTag | null {
  const icon = node.getPluginData(KEY_ICON);
  const svgHash = node.getPluginData(KEY_HASH);
  if (!icon || !svgHash) return null;

  const [prefix, ...rest] = icon.split(":");
  const libraryFingerprint = node.getPluginData(KEY_FINGERPRINT);

  return { icon, prefix, name: rest.join(":"), svgHash, libraryFingerprint };
}

function tagIconNode(node: SceneNode, icon: string, svgHash: string, libraryFingerprint: string): void {
  node.setPluginData(KEY_ICON, icon);
  node.setPluginData(KEY_HASH, svgHash);
  node.setPluginData(KEY_FINGERPRINT, libraryFingerprint);
}

const GRID_COLUMNS = 16;
const GRID_CELL = 40;
const ICON_TARGET_SIZE = 24;

/**
 * Insert a batch of icons (a search-result subset, or an entire library
 * style) as a grid inside one frame, tagging each icon individually.
 * Runs in chunks with a `setTimeout(0)` yield between them so the Figma UI
 * thread stays responsive on large libraries, and reports progress via
 * `onProgress` so the caller can show it.
 */
export async function insertIconsBatch(
  icons: IconInput[],
  libraryFingerprint: string,
  frameName: string,
  onProgress?: (done: number, total: number) => void
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = frameName;
  frame.fills = [];

  const columns = Math.min(GRID_COLUMNS, Math.max(1, icons.length));
  const rows = Math.max(1, Math.ceil(icons.length / columns));
  frame.resize(columns * GRID_CELL, rows * GRID_CELL);

  const viewport = figma.viewport.center;
  frame.x = viewport.x - frame.width / 2;
  frame.y = viewport.y - frame.height / 2;
  figma.currentPage.appendChild(frame);

  for (let i = 0; i < icons.length; i++) {
    const data = icons[i];
    const node = figma.createNodeFromSvg(data.svg);

    const scale = ICON_TARGET_SIZE / Math.max(node.width, node.height, 1);
    node.resize(node.width * scale, node.height * scale);

    const col = i % columns;
    const row = Math.floor(i / columns);
    node.x = col * GRID_CELL + (GRID_CELL - node.width) / 2;
    node.y = row * GRID_CELL + (GRID_CELL - node.height) / 2;
    node.name = data.icon;

    frame.appendChild(node);
    tagIconNode(node, data.icon, hashString(data.svg), libraryFingerprint);

    if (i % 25 === 24) {
      onProgress?.(i + 1, icons.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.(icons.length, icons.length);
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);

  return frame;
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
export function updateIconNode(existing: SceneNode, newSvg: string, icon: string, libraryFingerprint: string): UpdateResult {
  const newHash = hashString(newSvg);
  const tag = readIconTag(existing);
  if (tag && tag.svgHash === newHash) {
    tagIconNode(existing, icon, newHash, libraryFingerprint); // fingerprint may still have advanced even if this icon's own SVG didn't change
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
  tagIconNode(existing, icon, newHash, libraryFingerprint);

  return { node: existing, changed: true };
}

/**
 * Update every tracked node from one library style in place. `freshByName`
 * maps bare icon name -> freshly fetched IconData for that prefix.
 */
export async function updateLibraryNodes(
  nodes: SceneNode[],
  freshByName: Map<string, IconInput>,
  libraryFingerprint: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ updated: number }> {
  let updated = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const tag = readIconTag(node);
    const fresh = tag && freshByName.get(tag.name);
    if (tag && fresh) {
      const result = updateIconNode(node, fresh.svg, fresh.icon, libraryFingerprint);
      if (result.changed) updated++;
    }

    if (i % 25 === 24) {
      onProgress?.(i + 1, nodes.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.(nodes.length, nodes.length);
  return { updated };
}
