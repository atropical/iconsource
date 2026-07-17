/// <reference types="@figma/plugin-typings" />

import { MessageTypes, PluginCommands, PluginMessage, TrackedIconNode } from "./types.d";
import { findTrackedNodes, insertIconsBatch, readIconTag, updateLibraryNodes } from "./utils/iconTracking";
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

    await insertIconsBatch(msg.icons, msg.libraryFingerprint, frameName, token, (done, total) => {
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
    });

    if (isStaleRun(token)) return;
    figma.ui.postMessage({ type: MessageTypes.UPDATE_RESULT, prefix: msg.prefix, updated } as PluginMessage);
    figma.notify(updated > 0 ? `✅ Updated ${updated} icon${updated === 1 ? "" : "s"} in ${msg.prefix}` : `${msg.prefix} is already up to date`);
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

    case MessageTypes.SELECT_NODE_REQUEST:
      handleSelectNode(msg);
      break;

    default:
      console.warn(`Unknown message type: ${msg.type}`);
  }
};
