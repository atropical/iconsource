/// <reference types="@figma/plugin-typings" />

import { MessageTypes, PluginCommands, PluginMessage, TrackedIconNode } from "./types.d";
import { findTrackedNodes, insertIcon, readIconTag, updateIconNode } from "./utils/iconTracking";

figma.showUI(__html__, { width: 420, height: 600, themeColors: true });

figma.on("run", ({ command }) => {
  figma.ui.postMessage({
    type: MessageTypes.BASIC_INFO,
    command: command as PluginCommands,
    editorType: figma.editorType || "figma",
  } as PluginMessage);
});

function handleImport(msg: PluginMessage) {
  if (!msg.icon) {
    console.error("Import request missing icon data");
    return;
  }

  try {
    const node = insertIcon(msg.icon.svg, msg.icon.icon, msg.icon.collection.version);
    figma.ui.postMessage({
      type: MessageTypes.IMPORT_ICON_RESULT,
      nodeId: node.id,
    } as PluginMessage);
    figma.notify(`✅ Imported ${msg.icon.icon}`);
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
        importedVersion: tag.version,
      } as TrackedIconNode;
    })
    .filter((t): t is TrackedIconNode => t !== null);

  figma.ui.postMessage({
    type: MessageTypes.SCAN_TRACKED_RESULT,
    tracked,
  } as PluginMessage);
}

function handleUpdateIcon(msg: PluginMessage) {
  if (!msg.nodeId || !msg.updatedSvg || !msg.icon) {
    console.error("Update request missing nodeId, svg, or icon data");
    return;
  }

  try {
    const node = figma.getNodeById(msg.nodeId) as SceneNode | null;
    if (!node) throw new Error("That icon's node no longer exists in this document.");

    const result = updateIconNode(node, msg.updatedSvg, msg.icon.icon, msg.icon.collection.version);

    figma.ui.postMessage({
      type: MessageTypes.UPDATE_ICON_RESULT,
      nodeId: result.node.id,
    } as PluginMessage);

    figma.notify(result.changed ? `✅ Updated ${msg.icon.icon}` : `${msg.icon.icon} is already up to date`);
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

    case MessageTypes.IMPORT_ICON_REQUEST:
      handleImport(msg);
      break;

    case MessageTypes.SCAN_TRACKED_REQUEST:
      handleScanTracked();
      break;

    case MessageTypes.UPDATE_ICON_REQUEST:
      handleUpdateIcon(msg);
      break;

    case MessageTypes.SELECT_NODE_REQUEST:
      handleSelectNode(msg);
      break;

    default:
      console.warn(`Unknown message type: ${msg.type}`);
  }
};
