/// <reference types="@figma/plugin-typings" />

import { isStaleRun } from "./cancellation";
import type { IconColor, IconImportOptions } from "../types.d";

/**
 * Node tagging + version-safe replace for imported icons. Runs on the plugin
 * main thread (has document access, no DOM). Every icon Iconsource inserts is
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

/**
 * Tags live in *shared* plugin data, not private plugin data. Private
 * plugin data is namespaced by the manifest's plugin id, so any change to
 * that id (a re-registered plugin, a dev build vs the published one) makes
 * every previously written tag unreadable and silently unlinks every icon
 * already imported into a document. Shared plugin data is keyed by the
 * namespace below instead, so tags survive an id change.
 *
 * LEGACY_* are the old private keys; they're still read (and lazily copied
 * across on first sight) so documents tagged by pre-shared-data builds
 * running under the *current* plugin id keep working. Documents tagged
 * under an older plugin id can't be read here at all — see
 * scripts/build-rescue.mjs for the one-shot recovery build.
 */
export const NS = "iconsource";
export const KEY_ICON = "icon"; // "<prefix>:<name>"
export const KEY_HASH = "svgHash";
export const KEY_FINGERPRINT = "libraryFingerprint";
export const KEY_OPTIONS = "options"; // comma list, e.g. "outline,flatten"
export const KEY_COLOR = "color"; // JSON IconColor, empty when unset

export const LEGACY_KEY_ICON = `${NS}:icon`;
export const LEGACY_KEY_HASH = `${NS}:svgHash`;
export const LEGACY_KEY_FINGERPRINT = `${NS}:libraryFingerprint`;

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
  options: IconImportOptions;
}

function encodeOptions(options: IconImportOptions): string {
  return [options.outline && "outline", options.flatten && "flatten"].filter(Boolean).join(",");
}

function decodeOptions(raw: string): IconImportOptions {
  const set = new Set(raw.split(","));
  return { outline: set.has("outline"), flatten: set.has("flatten") };
}

export function readIconTag(node: SceneNode): IconTag | null {
  let icon = node.getSharedPluginData(NS, KEY_ICON);
  let svgHash = node.getSharedPluginData(NS, KEY_HASH);
  let libraryFingerprint = node.getSharedPluginData(NS, KEY_FINGERPRINT);

  if (!icon || !svgHash) {
    // Pre-shared-data tag written under the current plugin id: read it, then
    // promote it so this node is id-proof from here on.
    icon = node.getPluginData(LEGACY_KEY_ICON);
    svgHash = node.getPluginData(LEGACY_KEY_HASH);
    libraryFingerprint = node.getPluginData(LEGACY_KEY_FINGERPRINT);
    if (!icon || !svgHash) return null;
    tagIconNode(node, icon, svgHash, libraryFingerprint);
  }

  const [prefix, ...rest] = icon.split(":");

  const options = decodeOptions(node.getSharedPluginData(NS, KEY_OPTIONS));
  const rawColor = node.getSharedPluginData(NS, KEY_COLOR);
  if (rawColor) {
    try { options.color = JSON.parse(rawColor) as IconColor; } catch { /* ignore a malformed tag */ }
  }

  return { icon, prefix, name: rest.join(":"), svgHash, libraryFingerprint, options };
}

function tagIconNode(node: SceneNode, icon: string, svgHash: string, libraryFingerprint: string, options?: IconImportOptions): void {
  node.setSharedPluginData(NS, KEY_ICON, icon);
  node.setSharedPluginData(NS, KEY_HASH, svgHash);
  node.setSharedPluginData(NS, KEY_FINGERPRINT, libraryFingerprint);
  if (options) {
    node.setSharedPluginData(NS, KEY_OPTIONS, encodeOptions(options));
    node.setSharedPluginData(NS, KEY_COLOR, options.color ? JSON.stringify(options.color) : "");
  }
}

/** Identity of a colour choice, for telling whether options changed. */
function colorKey(color?: IconColor): string {
  if (!color) return "";
  if (color.kind === "hex") return `hex:${color.hex.toLowerCase()}`;
  if (color.kind === "variable") return `var:${color.key ?? color.id}`;
  return `style:${color.id}`;
}

function optionsKey(options: IconImportOptions): string {
  return `${encodeOptions(options)}|${colorKey(options.color)}`;
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.padEnd(6, "0");
  const n = parseInt(full.slice(0, 6), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** A colour choice resolved against the document, ready to stamp onto nodes. */
type ResolvedColor = { paint: SolidPaint } | { styleId: string };

const resolvedColors = new Map<string, Promise<ResolvedColor | null>>();

/**
 * Turn a colour choice into a paint or style id. Library variables are
 * imported into the file once per session; a variable or style that no
 * longer exists resolves to null and the icon keeps its original colour.
 */
function resolveColor(color: IconColor): Promise<ResolvedColor | null> {
  const key = colorKey(color);
  const cached = resolvedColors.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<ResolvedColor | null> => {
    if (color.kind === "hex") return { paint: { type: "SOLID", color: hexToRgb(color.hex) } };
    if (color.kind === "style") {
      const style = await figma.getStyleByIdAsync(color.id);
      return style ? { styleId: style.id } : null;
    }
    const variable = color.key
      ? await figma.variables.importVariableByKeyAsync(color.key)
      : color.id ? await figma.variables.getVariableByIdAsync(color.id) : null;
    if (!variable) return null;
    const base: SolidPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
    return { paint: figma.variables.setBoundVariableForPaint(base, "color", variable) };
  })().catch((e) => {
    console.error("Could not resolve icon colour", e);
    resolvedColors.delete(key);
    return null;
  });

  resolvedColors.set(key, promise);
  return promise;
}

/** Recolour every visible fill and stroke inside the icon. Layers with neither (clip masks, empty groups) are left alone. */
async function applyColor(container: ChildrenMixin & SceneNode, color: IconColor): Promise<void> {
  const resolved = await resolveColor(color);
  if (!resolved) return;

  const walk = async (n: SceneNode) => {
    if ("fills" in n && hasVisibleFill(n)) {
      if ("paint" in resolved) (n as GeometryMixin).fills = [resolved.paint];
      else await (n as unknown as MinimalFillsMixin).setFillStyleIdAsync(resolved.styleId);
    }
    if ("strokes" in n && (n as GeometryMixin).strokes.some((p) => p.visible !== false)) {
      if ("paint" in resolved) (n as GeometryMixin).strokes = [resolved.paint];
      else await (n as unknown as MinimalStrokesMixin).setStrokeStyleIdAsync(resolved.styleId);
    }
    if ("children" in n) for (const child of (n as ChildrenMixin).children) await walk(child);
  };
  for (const child of container.children) await walk(child);
}

type StrokableNode = SceneNode & GeometryMixin;

function hasVisibleStroke(node: SceneNode): node is StrokableNode {
  return "outlineStroke" in node && "strokes" in node
    && (node as GeometryMixin).strokes.some((p) => p.visible !== false)
    && (node as unknown as MinimalStrokesMixin).strokeWeight !== 0;
}

function hasVisibleFill(node: SceneNode): boolean {
  return "fills" in node && Array.isArray(node.fills) && (node.fills as Paint[]).some((p) => p.visible !== false);
}

/**
 * Replace every stroked shape inside `container` with its outlined
 * equivalent, in the same spot in the layer order. A shape that also has a
 * fill keeps its fill and just loses the stroke, so filled and outlined
 * parts sit side by side the way the editor's Outline stroke leaves them.
 */
function outlineStrokes(container: ChildrenMixin & SceneNode): void {
  const targets: StrokableNode[] = [];
  const walk = (n: SceneNode) => {
    if (hasVisibleStroke(n)) targets.push(n);
    if ("children" in n) for (const child of (n as ChildrenMixin).children) walk(child);
  };
  for (const child of container.children) walk(child);

  for (const shape of targets) {
    const parent = shape.parent as (ChildrenMixin & BaseNode) | null;
    if (!parent) continue;
    const absolute = shape.absoluteTransform;
    const outlined = (shape as unknown as GeometryMixin).outlineStroke();
    if (!outlined) continue;

    parent.insertChild(parent.children.indexOf(shape) + 1, outlined);
    // outlineStroke doesn't document where the new node lands; pin it back
    // over the original shape in case it was created elsewhere.
    if ("absoluteTransform" in parent) {
      const [[a, c, e], [b, d, f]] = (parent as unknown as LayoutMixin).absoluteTransform;
      const det = a * d - c * b;
      const [[sa, sc, se], [sb, sd, sf]] = absolute;
      const inv = [[d / det, -c / det, (c * f - d * e) / det], [-b / det, a / det, (b * e - a * f) / det]];
      const mul = (r: number[]): [number, number, number] => [
        r[0] * sa + r[1] * sb, r[0] * sc + r[1] * sd, r[0] * se + r[1] * sf + r[2],
      ];
      outlined.relativeTransform = [mul(inv[0]), mul(inv[1])];
    }
    outlined.name = shape.name;

    if (hasVisibleFill(shape)) (shape as unknown as GeometryMixin).strokes = [];
    else shape.remove();
  }
}

/** Apply the chosen import options to a freshly created icon frame. Outline runs first so Flatten merges the outlined result, and colour last so it lands on the final layers. */
async function applyIconOptions(container: ChildrenMixin & SceneNode, options: IconImportOptions): Promise<void> {
  if (options.outline) outlineStrokes(container);
  if (options.flatten && container.children.length > 0) {
    const vector = figma.flatten([...container.children], container);
    vector.name = container.name;
  }
  if (options.color) await applyColor(container, options.color);
}

const GRID_COLUMNS = 16;
const GRID_CELL = 56;
const ICON_TARGET_SIZE = 24;

/**
 * Insert a batch of icons (a search-result subset, or an entire library
 * style) as a grid inside one section, tagging each icon individually.
 * Sections (rather than a frame) keep the imported icons visually grouped
 * on the canvas without auto-layout/clipping side effects, and read better
 * for a whole-library drop than a frame does.
 * Runs in chunks with a `setTimeout(0)` yield between them so the Figma UI
 * thread stays responsive on large libraries, and reports progress via
 * `onProgress` so the caller can show it. `runToken` is checked at each
 * yield so a stale invocation (superseded by a new run, or the plugin
 * closing mid-import) stops inserting further nodes instead of quietly
 * continuing in the background — see utils/cancellation.
 */
export async function insertIconsBatch(
  icons: IconInput[],
  libraryFingerprint: string,
  options: IconImportOptions,
  frameName: string,
  runToken: number,
  onProgress?: (done: number, total: number) => void
): Promise<SectionNode> {
  const frame = figma.createSection();
  frame.name = frameName;
  frame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  frame.strokes = [];
  frame.setRelaunchData({ "check-updates": "Check this library for icon updates" });

  const columns = Math.min(GRID_COLUMNS, Math.max(1, icons.length));
  const rows = Math.max(1, Math.ceil(icons.length / columns));
  frame.resizeWithoutConstraints(columns * GRID_CELL, rows * GRID_CELL);

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
    await applyIconOptions(node, options);
    tagIconNode(node, data.icon, hashString(data.svg), libraryFingerprint, options);
    node.setRelaunchData({ "check-updates": "Check this icon for updates" });

    if (i % 25 === 24) {
      onProgress?.(i + 1, icons.length);
      await new Promise((r) => setTimeout(r, 0));
      if (isStaleRun(runToken)) return frame;
    }
  }

  onProgress?.(icons.length, icons.length);
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);

  return frame;
}

/**
 * Recursively find every node on every page tagged as an Iconsource-imported
 * icon. The manifest uses "dynamic-page" documentAccess, so every page but
 * the current one is unloaded until asked for — touching `.children` on one
 * before that throws rather than hangs, which without this would silently
 * kill the scan on any multi-page file and leave the caller waiting forever
 * for a response that never comes.
 *
 * `runToken`, if given, is checked right after the (potentially slow)
 * `loadAllPagesAsync` so a scan superseded by a new run or a plugin close
 * doesn't bother walking the whole document afterwards.
 */
export async function findTrackedNodes(runToken?: number): Promise<SceneNode[]> {
  await figma.loadAllPagesAsync();
  if (runToken !== undefined && isStaleRun(runToken)) return [];

  const found: SceneNode[] = [];

  const walk = (node: BaseNode) => {
    // Instances are copies of a main component: their layers can't be
    // removed or replaced, and updating the main component updates them
    // anyway. This also covers an icon that was itself turned into a
    // component, whose instances inherit its tag. Checked before the tag so
    // those tagged instances are skipped too.
    if (node.type === "INSTANCE") return;
    if ("getSharedPluginData" in node && readIconTag(node as SceneNode)) {
      const icon = node as SceneNode;
      found.push(icon);
      // Relaunch data is plugin-id scoped like private plugin data, so icons
      // tagged under an older id lost their relaunch button too. Re-set it
      // whenever we see a tracked node — cheap, idempotent, and restores the
      // button under whatever id is running now.
      icon.setRelaunchData({ "check-updates": "Check this icon for updates" });
      return; // don't descend into an icon's own internals looking for nested tags
    }
    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) walk(child);
    }
  };

  for (const page of figma.root.children) walk(page);
  return found;
}

/**
 * Stop tracking every icon from one library style: clears the tags so the
 * icons stay on the canvas but no longer show up in Check for Updates.
 */
export async function untrackLibrary(prefix: string): Promise<number> {
  const nodes = (await findTrackedNodes()).filter((node) => readIconTag(node)?.prefix === prefix);
  for (const node of nodes) {
    for (const key of [KEY_ICON, KEY_HASH, KEY_FINGERPRINT, KEY_OPTIONS, KEY_COLOR]) node.setSharedPluginData(NS, key, "");
    for (const key of [LEGACY_KEY_ICON, LEGACY_KEY_HASH, LEGACY_KEY_FINGERPRINT]) node.setPluginData(key, "");
    node.setRelaunchData({});
  }
  return nodes.length;
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
 * place: the outer node Iconsource inserted keeps its id (so selection,
 * prototype links, dev-mode comments, etc. pinned to it survive), only its
 * inner vector paths are swapped. User-applied colours are captured before
 * the swap and reapplied by traversal order afterwards.
 */
export async function updateIconNode(
  existing: SceneNode,
  newSvg: string,
  icon: string,
  libraryFingerprint: string,
  options?: IconImportOptions,
  force = false
): Promise<UpdateResult> {
  const newHash = hashString(newSvg);
  const tag = readIconTag(existing);
  // Without explicit options an update keeps whatever the icon was imported with.
  const effective = options ?? tag?.options ?? {};
  if (tag && tag.svgHash === newHash && !force) {
    tagIconNode(existing, icon, newHash, libraryFingerprint); // fingerprint may still have advanced even if this icon's own SVG didn't change
    return { node: existing, changed: false };
  }

  if (!("children" in existing)) {
    throw new Error("Tracked icon node has no children to replace — was it modified outside Iconsource?");
  }

  const fills = captureFills(existing);
  const container = existing as unknown as ChildrenMixin & SceneNode;

  // figma.createNodeFromSvg appends its result to the current page as a
  // scratch node; its children get moved into the existing node, then it's
  // discarded.
  const scratch = figma.createNodeFromSvg(newSvg);
  // Scale the new geometry to the icon's current size before moving it in,
  // so an update keeps the size the icon was placed at (24px on import, or
  // whatever the user resized it to) instead of jumping to the SVG's native
  // viewBox size.
  const scale = Math.min(existing.width / Math.max(scratch.width, 1), existing.height / Math.max(scratch.height, 1));
  if (Number.isFinite(scale) && scale > 0) scratch.rescale(scale);

  for (const child of [...container.children]) child.remove();
  for (const child of [...(scratch as unknown as ChildrenMixin).children]) {
    container.appendChild(child);
  }
  scratch.remove();

  await applyIconOptions(container, effective);
  // Fills are matched by layer order, which only lines up when the layer
  // structure is built the same way as before. After an options change
  // (say, stroke paths now outlined into filled shapes) the old fills would
  // land on the wrong kind of layer, so the fresh import's fills stay.
  // A chosen colour always wins, so restoring old fills only happens
  // without one.
  if (!effective.color && optionsKey(effective) === optionsKey(tag?.options ?? {})) applyFills(existing, fills);
  tagIconNode(existing, icon, newHash, libraryFingerprint, effective);

  return { node: existing, changed: true };
}

/**
 * Update every tracked node from one library style in place. `freshByName`
 * maps bare icon name -> freshly fetched IconData for that prefix.
 * `runToken` is checked at each yield — see insertIconsBatch above for why.
 */
export async function updateLibraryNodes(
  nodes: SceneNode[],
  freshByName: Map<string, IconInput>,
  libraryFingerprint: string,
  runToken: number,
  onProgress?: (done: number, total: number) => void,
  options?: IconImportOptions,
  force = false
): Promise<{ updated: number }> {
  let updated = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const tag = readIconTag(node);
    const fresh = tag && freshByName.get(tag.name);
    if (tag && fresh) {
      // One locked or otherwise uneditable icon shouldn't abort the rest of the library.
      try {
        const result = await updateIconNode(node, fresh.svg, fresh.icon, libraryFingerprint, options, force);
        if (result.changed) updated++;
      } catch (e) {
        console.warn(`Skipped ${node.name} (${node.id})`, e);
      }
    }

    if (i % 25 === 24) {
      onProgress?.(i + 1, nodes.length);
      await new Promise((r) => setTimeout(r, 0));
      if (isStaleRun(runToken)) return { updated };
    }
  }

  onProgress?.(nodes.length, nodes.length);
  return { updated };
}
