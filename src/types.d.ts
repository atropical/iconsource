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

  // Import a handful of individually-picked icons (search results within a style)
  IMPORT_ICONS_REQUEST = "IMPORT.ICONS.REQUEST",
  IMPORT_PROGRESS = "IMPORT.PROGRESS",
  IMPORT_RESULT = "IMPORT.RESULT",
  IMPORT_ERROR = "IMPORT.ERROR",

  // Update tracking, grouped by library style (prefix)
  SCAN_TRACKED_REQUEST = "UPDATE.SCAN.REQUEST",
  SCAN_TRACKED_RESULT = "UPDATE.SCAN.RESULT",
  UPDATE_LIBRARY_REQUEST = "UPDATE.LIBRARY.REQUEST",
  UPDATE_PROGRESS = "UPDATE.PROGRESS",
  UPDATE_RESULT = "UPDATE.RESULT",
  UPDATE_ERROR = "UPDATE.ERROR",

  // Selection sync (for jumping to a tracked node on the canvas)
  SELECT_NODE_REQUEST = "SELECT.NODE.REQUEST",
}

/** License metadata for an icon collection, as surfaced by Iconify. */
export interface IconLicense {
  title: string;
  spdx?: string;
  url?: string;
}

/** One style/prefix within a library, e.g. "Phosphor Bold" (prefix "ph-bold") inside the "Phosphor" library. */
export interface LibraryStyle {
  prefix: string;
  /** Style label with the shared library name stripped, e.g. "Bold", "Duotone", or "Default" when the set has only one style. */
  label: string;
  total: number;
  /** Iconify's own version string for this prefix, when available. */
  version?: string;
}

/** A browsable icon library — one or more Iconify prefixes grouped by shared name/author, e.g. all of Phosphor's styles. */
export interface IconLibrary {
  id: string;
  displayName: string;
  author: { name: string; url?: string };
  license: IconLicense;
  repo?: string;
  styles: LibraryStyle[];
  totalIcons: number;
  /** A handful of icon ids (from the default style) to render as a preview. */
  sampleIcons: string[];
}

/** A fully resolved icon body, ready to insert. */
export interface IconData {
  icon: string;
  prefix: string;
  name: string;
  svg: string;
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
  libraryFingerprint: string;
}

/** Tracked icons grouped by the library style (prefix) they came from, for library-level sync. */
export interface TrackedLibraryGroup {
  prefix: string;
  icons: TrackedIconNode[];
  /** The fingerprint stored at import time (all icons in a group share one, from the last import/update of that prefix). */
  importedFingerprint: string;
  /** Filled in by the UI after comparing importedFingerprint to the live one. */
  currentFingerprint?: string;
  updateAvailable?: boolean;
}

export interface PluginMessage {
  type: MessageTypes;
  command?: PluginCommands;
  editorType?: string;

  // Import
  icons?: IconData[];
  libraryFingerprint?: string;
  imported?: number;
  total?: number;
  error?: string;

  // Update scan/apply
  tracked?: TrackedIconNode[];
  prefix?: string;
  updated?: number;

  // Selection sync
  nodeId?: string;
}
