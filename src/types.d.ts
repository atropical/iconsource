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
  SCAN_TRACKED_ERROR = "UPDATE.SCAN.ERROR",
  UPDATE_LIBRARY_REQUEST = "UPDATE.LIBRARY.REQUEST",
  UPDATE_PROGRESS = "UPDATE.PROGRESS",
  UPDATE_RESULT = "UPDATE.RESULT",
  UPDATE_ERROR = "UPDATE.ERROR",
  UNTRACK_LIBRARY_REQUEST = "UPDATE.UNTRACK.REQUEST",

  // Selection sync (for jumping to a tracked node on the canvas)
  SELECT_NODE_REQUEST = "SELECT.NODE.REQUEST",

  // Persisted user preferences (figma.clientStorage, keyed per Figma user)
  PREFS_GET_REQUEST = "PREFS.GET.REQUEST",
  PREFS_GET_RESULT = "PREFS.GET.RESULT",
  PREFS_SET_REQUEST = "PREFS.SET.REQUEST",

  // Colour variables and styles the user can pick as an icon colour
  COLOR_SOURCES_REQUEST = "COLOR.SOURCES.REQUEST",
  COLOR_SOURCES_RESULT = "COLOR.SOURCES.RESULT",
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
  /** True for multi-colour sets (emoji, logos), where flattening would merge every colour into one fill. */
  palette?: boolean;
}

/** Post-processing applied to an icon after it's created from SVG, remembered per icon in its tag. */
export interface IconImportOptions {
  /** Convert strokes into filled outlines (Outline stroke). */
  outline?: boolean;
  /** Merge all of the icon's layers into one vector (Flatten). */
  flatten?: boolean;
  /** Colour applied to every fill and stroke once outline/flatten have run. */
  color?: IconColor;
}

/**
 * A colour choice. Variables carry `key` when they come from a team library
 * (imported into the file on use) and `id` when local; styles are local only,
 * as the plugin API can't list team library styles.
 */
export type IconColor =
  | { kind: "hex"; hex: string }
  | { kind: "variable"; id?: string; key?: string; name: string; group: string; hex?: string }
  | { kind: "style"; id: string; name: string; hex?: string };

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
 * Record of an icon Iconsource has previously inserted into this document,
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
  options: IconImportOptions;
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
  /** Multi-colour set, where Flatten is unavailable. */
  palette?: boolean;
}

/** Sort/filter choices the user has made, persisted across sessions via figma.clientStorage. */
export interface IconsourcePrefs {
  /** LibrariesView's "Popular / A→Z / Most icons" control. */
  librarySortOrder?: "popular" | "az" | "most-icons";
  /** LibraryDetailView's "A→Z / Z→A" icon-name sort control. */
  iconSortOrder?: "az" | "za";
  /** Import options last chosen in LibraryDetailView. */
  importOptions?: IconImportOptions;
}

export interface PluginMessage {
  type: MessageTypes;
  command?: PluginCommands;
  editorType?: string;

  // Import
  icons?: IconData[];
  libraryFingerprint?: string;
  options?: IconImportOptions;
  imported?: number;
  total?: number;
  error?: string;

  // Update scan/apply
  tracked?: TrackedIconNode[];
  prefix?: string;
  updated?: number;
  /** UPDATE_LIBRARY_REQUEST: rebuild every icon even if its SVG is unchanged, e.g. to apply new import options. */
  force?: boolean;

  // Selection sync
  nodeId?: string;

  // Prefs: PREFS_GET_RESULT carries the full saved object; PREFS_SET_REQUEST
  // carries only the keys being changed and is merged into what's stored.
  prefs?: Partial<IconsourcePrefs>;

  // COLOR_SOURCES_RESULT
  colorSources?: IconColor[];
}
