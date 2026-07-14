/// <reference types="@figma/plugin-typings" />

import { MessageTypes, PluginCommands, PluginMessage, TrackedIconNode } from "./types.d";
import { findTrackedNodes, insertIconsBatch, readIconTag, updateLibraryNodes } from "./utils/iconTracking";

figma.showUI(__html__, { width: 480, height: 640, themeColors: true });

figma.on("run", ({ command }) => {
  figma.ui.postMessage({
    type: MessageTypes.BASIC_INFO,
    command: command as PluginCommands,
    editorType: figma.editorType || "figma",
  } as PluginMessage);
});

async function handleImportIcons(msg: PluginMessage) {
  if (!msg.icons || msg.icons.length === 0 || !msg.libraryFingerprint) {
    console.error("Import request missing icons or libraryFingerprint");
    return;
  }

  try {
    const frameName = msg.icons.length === 1 ? msg.icons[0].icon : `${msg.icons[0].prefix} (${msg.icons.length} icons)`;

    await insertIconsBatch(msg.icons, msg.libraryFingerprint, frameName, (done, total) => {
      figma.ui.postMessage({ type: MessageTypes.IMPORT_PROGRESS, imported: done, total } as PluginMessage);
    });

    figma.ui.postMessage({ type: MessageTypes.IMPORT_RESULT, imported: msg.icons.length, total: msg.icons.length } as PluginMessage);
    figma.notify(`✅ Imported ${msg.icons.length} icon${msg.icons.length === 1 ? "" : "s"}`);
  } catch (error) {
    console.error(error);
    figma.ui.postMessage({
      type: MessageTypes.IMPORT_ERROR,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    } as PluginMessage);
  }
}

function handleScanTracked() {
  const nodes = findTrackedNodes();
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
}

async function handleUpdateLibrary(msg: PluginMessage) {
  if (!msg.prefix || !msg.icons || !msg.libraryFingerprint) {
    console.error("Update request missing prefix, icons, or libraryFingerprint");
    return;
  }

  try {
    const nodes = findTrackedNodes().filter((node) => readIconTag(node)?.prefix === msg.prefix);
    const freshByName = new Map(msg.icons.map((icon) => [icon.name, icon]));

    const { updated } = await updateLibraryNodes(nodes, freshByName, msg.libraryFingerprint, (done, total) => {
      figma.ui.postMessage({ type: MessageTypes.UPDATE_PROGRESS, imported: done, total } as PluginMessage);
    });

    figma.ui.postMessage({ type: MessageTypes.UPDATE_RESULT, prefix: msg.prefix, updated } as PluginMessage);
    figma.notify(updated > 0 ? `✅ Updated ${updated} icon${updated === 1 ? "" : "s"} in ${msg.prefix}` : `${msg.prefix} is already up to date`);
  } catch (error) {
    console.error(error);
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
      handleScanTracked();
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
