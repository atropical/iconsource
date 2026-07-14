/// <reference types="@figma/plugin-typings" />

/**
 * Plugin command types for menu actions
 */
export enum PluginCommands {
  BROWSE = "browse",
  CHECK_UPDATES = "check-updates",
}

/**
 * Message types for plugin <-> UI communication
 */
export enum MessageTypes {
  // Info messages
  GET_BASIC_INFO = "INFO.GET_BASIC_INFO",
  BASIC_INFO = "INFO.BASIC_INFO",

  // Import
  IMPORT_ICON_REQUEST = "IMPORT.ICON.REQUEST",
  IMPORT_ICON_RESULT = "IMPORT.ICON.RESULT",
  IMPORT_ERROR = "IMPORT.ERROR",

  // Update tracking
  SCAN_TRACKED_REQUEST = "UPDATE.SCAN.REQUEST",
  SCAN_TRACKED_RESULT = "UPDATE.SCAN.RESULT",
  UPDATE_ICON_REQUEST = "UPDATE.ICON.REQUEST",
  UPDATE_ICON_RESULT = "UPDATE.ICON.RESULT",
  UPDATE_ERROR = "UPDATE.ERROR",

  // Selection sync (for showing which tracked node is selected)
  SELECT_NODE_REQUEST = "SELECT.NODE.REQUEST",
}

/**
 * License metadata for an icon collection, as surfaced by Iconify.
 */
export interface IconLicense {
  title: string;
  spdx?: string;
  url?: string;
}

/**
 * Metadata about a single icon collection/library (e.g. "lucide", "ph", "tabler").
 */
export interface IconCollectionInfo {
  prefix: string;
  name: string;
  total: number;
  author: { name: string; url?: string };
  license: IconLicense;
  /** Repo URL, when Iconify exposes one for the collection's author/samples. */
  repo?: string;
  /** Iconify's own per-collection version string, when available. Informational only —
   * the SVG content hash is what actually drives update detection. */
  version?: string;
}

/** A single icon search hit, before the SVG body has been fetched. */
export interface IconSearchResult {
  /** "<prefix>:<name>", Iconify's canonical icon id */
  icon: string;
  prefix: string;
  name: string;
}

/** A fully resolved icon, ready to preview or import. */
export interface IconPreview {
  icon: string;
  prefix: string;
  name: string;
  svg: string;
  collection: IconCollectionInfo;
}

/**
 * Record of an icon Icontopia has previously inserted into this document,
 * read back from a tagged node's pluginData. See utils/iconTracking.ts for
 * the pluginData keys this mirrors.
 */
export interface TrackedIconNode {
  nodeId: string;
  name: string;
  icon: string;
  prefix: string;
  iconName: string;
  svgHash: string;
  importedVersion?: string;
  /** Set once the plugin has checked and found the live SVG hash differs. */
  updateAvailable?: boolean;
}

export interface PluginMessage {
  type: MessageTypes;
  command?: PluginCommands;
  editorType?: string;

  // Import
  icon?: IconPreview;
  nodeId?: string;
  error?: string;

  // Update scan/apply
  tracked?: TrackedIconNode[];
  updatedSvg?: string;
}
