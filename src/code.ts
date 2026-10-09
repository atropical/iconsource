/// <reference types="@figma/plugin-typings" />

import { IconColor, IconsourcePrefs, MessageTypes, PluginCommands, PluginMessage, TrackedIconNode } from "./types.d";
import { findTrackedNodes, insertIconsBatch, readIconTag, untrackLibrary, updateLibraryNodes } from "./utils/iconTracking";
import { bumpRunToken, currentRunToken, isStaleRun } from "./utils/cancellation";

figma.showUI(__html__, { width: 760, height: 720, themeColors: true });

figma.on("run", ({ command }) => {
  // A relaunch button or menu command re-triggers "run" without tearing
  // down this context, so a previous invocation's still-running import/scan
  // loop needs a way to notice it's been superseded — see utils/cancellation.
  bumpRunToken();
  figma.ui.postMessage({
    type: MessageTypes.BASIC_INFO,
    command: command as PluginCommands,
    editorType: figma.editorType || "figma",
  } as PluginMessage);
});

// Fires right before the plugin is torn down (user closed it, or Figma is
// unloading it). Bumping the token here means any in-flight loop's next
// staleness check stops it from doing further pointless document edits or
// posting to a UI that's already gone.
figma.on("close", () => {
  bumpRunToken();
});

async function handleImportIcons(msg: PluginMessage) {
  if (!msg.icons || msg.icons.length === 0 || !msg.libraryFingerprint) {
    console.error("Import request missing icons or libraryFingerprint");
    return;
  }

  const token = currentRunToken();

  try {
    const frameName = msg.icons.length === 1 ? msg.icons[0].icon : `${msg.icons[0].prefix} (${msg.icons.length} icons)`;

    await insertIconsBatch(msg.icons, msg.libraryFingerprint, msg.options ?? {}, frameName, token, (done, total) => {
      if (isStaleRun(token)) return;
      figma.ui.postMessage({ type: MessageTypes.IMPORT_PROGRESS, imported: done, total } as PluginMessage);
    });

    if (isStaleRun(token)) return;
    figma.ui.postMessage({ type: MessageTypes.IMPORT_RESULT, imported: msg.icons.length, total: msg.icons.length } as PluginMessage);
    figma.notify(`✅ Imported ${msg.icons.length} icon${msg.icons.length === 1 ? "" : "s"}`);
  } catch (error) {
    console.error(error);
    if (isStaleRun(token)) return;
    figma.ui.postMessage({
      type: MessageTypes.IMPORT_ERROR,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    } as PluginMessage);
  }
}

async function handleScanTracked() {
  const token = currentRunToken();

  try {
    const nodes = await findTrackedNodes(token);
    if (isStaleRun(token)) return;

    const tracked: TrackedIconNode[] = nodes
      .map((node) => {
        const tag = readIconTag(node);
        if (!tag) return null;
        return {
          nodeId: node.id,
          name: node.name,
          icon: tag.icon,
          prefix: tag.prefix,
          iconName: tag.name,
          svgHash: tag.svgHash,
          libraryFingerprint: tag.libraryFingerprint,
          options: tag.options,
        } as TrackedIconNode;
      })
      .filter((t): t is TrackedIconNode => t !== null);

    figma.ui.postMessage({ type: MessageTypes.SCAN_TRACKED_RESULT, tracked } as PluginMessage);
  } catch (error) {
    console.error(error);
    if (isStaleRun(token)) return;
    figma.ui.postMessage({
      type: MessageTypes.SCAN_TRACKED_ERROR,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    } as PluginMessage);
  }
}

async function handleUpdateLibrary(msg: PluginMessage) {
  if (!msg.prefix || !msg.icons || !msg.libraryFingerprint) {
    console.error("Update request missing prefix, icons, or libraryFingerprint");
    return;
  }

  const token = currentRunToken();

  try {
    const nodes = (await findTrackedNodes(token)).filter((node) => readIconTag(node)?.prefix === msg.prefix);
    if (isStaleRun(token)) return;

    const freshByName = new Map(msg.icons.map((icon) => [icon.name, icon]));

    const { updated } = await updateLibraryNodes(nodes, freshByName, msg.libraryFingerprint, token, (done, total) => {
      if (isStaleRun(token)) return;
      figma.ui.postMessage({ type: MessageTypes.UPDATE_PROGRESS, imported: done, total } as PluginMessage);
    }, msg.options, msg.force);

    if (isStaleRun(token)) return;
    figma.ui.postMessage({ type: MessageTypes.UPDATE_RESULT, prefix: msg.prefix, updated } as PluginMessage);
    figma.notify(updated > 0 ? `✅ ${msg.force ? "Rebuilt" : "Updated"} ${updated} icon${updated === 1 ? "" : "s"} in ${msg.prefix}` : `${msg.prefix} is already up to date`);
  } catch (error) {
    console.error(error);
    if (isStaleRun(token)) return;
    figma.ui.postMessage({
      type: MessageTypes.UPDATE_ERROR,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    } as PluginMessage);
  }
}

function handleSelectNode(msg: PluginMessage) {
  if (!msg.nodeId) return;
  const node = figma.getNodeById(msg.nodeId) as SceneNode | null;
  if (!node) return;
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}

const PREFS_KEY = "iconsource:prefs";

async function handleGetPrefs() {
  const prefs: IconsourcePrefs = (await figma.clientStorage.getAsync(PREFS_KEY)) ?? {};
  figma.ui.postMessage({ type: MessageTypes.PREFS_GET_RESULT, prefs } as PluginMessage);
}

async function handleSetPrefs(msg: PluginMessage) {
  if (!msg.prefs) return;
  const existing: IconsourcePrefs = (await figma.clientStorage.getAsync(PREFS_KEY)) ?? {};
  await figma.clientStorage.setAsync(PREFS_KEY, { ...existing, ...msg.prefs });
}

function rgbToHex({ r, g, b }: RGB): string {
  return "#" + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

/**
 * Everything the colour picker can offer: local colour variables (with their
 * default mode value as a swatch), colour variables from enabled team
 * libraries (no swatch, the value isn't known until imported), and local
 * solid paint styles. Library lookups fail without team library access, so
 * each source is gathered independently and a failure just leaves it out.
 */
async function handleColorSources() {
  // Awaited lists go into variables before looping: Figma's QuickJS sandbox
  // fails to compile `for (... of await ...)` once esbuild lowers it to a
  // generator ("stack underflow"), which stops the whole plugin loading.
  const sources: IconColor[] = [];

  try {
    const collections = new Map((await figma.variables.getLocalVariableCollectionsAsync()).map((c) => [c.id, c]));
    const localVariables = await figma.variables.getLocalVariablesAsync("COLOR");
    for (const v of localVariables) {
      const collection = collections.get(v.variableCollectionId);
      const value = collection && v.valuesByMode[collection.defaultModeId];
      const hex = value && typeof value === "object" && "r" in value ? rgbToHex(value as RGB) : undefined;
      sources.push({ kind: "variable", id: v.id, name: v.name, group: collection?.name ?? "Local variables", hex });
    }
  } catch (e) { console.error(e); }

  try {
    const libraryCollections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    for (const collection of libraryCollections) {
      const vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(collection.key);
      for (const v of vars) {
        if (v.resolvedType !== "COLOR") continue;
        sources.push({ kind: "variable", key: v.key, name: v.name, group: `${collection.libraryName} / ${collection.name}` });
      }
    }
  } catch (e) { console.error(e); }

  try {
    const paintStyles = await figma.getLocalPaintStylesAsync();
    for (const style of paintStyles) {
      const solid = style.paints.length === 1 && style.paints[0].type === "SOLID" ? style.paints[0] as SolidPaint : null;
      if (!solid) continue;
      sources.push({ kind: "style", id: style.id, name: style.name, hex: rgbToHex(solid.color) });
    }
  } catch (e) { console.error(e); }

  figma.ui.postMessage({ type: MessageTypes.COLOR_SOURCES_RESULT, colorSources: sources } as PluginMessage);
}

figma.ui.onmessage = async (msg: PluginMessage) => {
  switch (msg.type) {
    case MessageTypes.GET_BASIC_INFO:
      figma.ui.postMessage({
        type: MessageTypes.BASIC_INFO,
        editorType: figma.editorType || "figma",
      } as PluginMessage);
      break;

    case MessageTypes.IMPORT_ICONS_REQUEST:
      await handleImportIcons(msg);
      break;

    case MessageTypes.SCAN_TRACKED_REQUEST:
      await handleScanTracked();
      break;

    case MessageTypes.UPDATE_LIBRARY_REQUEST:
      await handleUpdateLibrary(msg);
      break;

    case MessageTypes.UNTRACK_LIBRARY_REQUEST:
      if (msg.prefix) {
        const count = await untrackLibrary(msg.prefix);
        figma.notify(`Stopped tracking ${count} icon${count === 1 ? "" : "s"} from ${msg.prefix}`);
        await handleScanTracked();
      }
      break;

    case MessageTypes.SELECT_NODE_REQUEST:
      handleSelectNode(msg);
      break;

    case MessageTypes.PREFS_GET_REQUEST:
      await handleGetPrefs();
      break;

    case MessageTypes.COLOR_SOURCES_REQUEST:
      await handleColorSources();
      break;

    case MessageTypes.PREFS_SET_REQUEST:
      await handleSetPrefs(msg);
      break;

    default:
      console.warn(`Unknown message type: ${msg.type}`);
  }
};
