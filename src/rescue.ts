/// <reference types="@figma/plugin-typings" />

/**
 * One-shot recovery build. NOT part of the shipped plugin.
 *
 * Iconsource originally tagged imported icons with private plugin data,
 * which Figma namespaces by manifest plugin id. The plugin id changed
 * (0000000000000000001 -> 1660068674953897925 -> 1660086718844081106), so
 * icons imported under an earlier id became invisible to the published
 * plugin — the tags are still on the nodes, just in a namespace the current
 * id can't read.
 *
 * This script is built under an *old* plugin id (see
 * scripts/build-rescue.mjs) so it can read that old private data, and
 * copies it into shared plugin data, which is keyed by namespace rather
 * than plugin id. The published plugin reads shared data, so once this has
 * run over a document its icons are tracked again — and stay tracked
 * through any future id change.
 *
 * Run it once per affected document. It only ever writes shared plugin
 * data; no node is created, moved, or deleted.
 */

const NS = "iconsource";
const KEY_ICON = "icon";
const KEY_HASH = "svgHash";
const KEY_FINGERPRINT = "libraryFingerprint";

const LEGACY_KEY_ICON = `${NS}:icon`;
const LEGACY_KEY_HASH = `${NS}:svgHash`;
const LEGACY_KEY_FINGERPRINT = `${NS}:libraryFingerprint`;

async function migrate(): Promise<{ migrated: number; alreadyShared: number }> {
  await figma.loadAllPagesAsync();

  let migrated = 0;
  let alreadyShared = 0;

  const walk = (node: BaseNode) => {
    if ("getSharedPluginData" in node) {
      const scene = node as SceneNode;

      if (scene.getSharedPluginData(NS, KEY_ICON) && scene.getSharedPluginData(NS, KEY_HASH)) {
        alreadyShared++;
        return; // already recovered (or imported by a shared-data build)
      }

      const icon = scene.getPluginData(LEGACY_KEY_ICON);
      const svgHash = scene.getPluginData(LEGACY_KEY_HASH);
      if (icon && svgHash) {
        scene.setSharedPluginData(NS, KEY_ICON, icon);
        scene.setSharedPluginData(NS, KEY_HASH, svgHash);
        scene.setSharedPluginData(NS, KEY_FINGERPRINT, scene.getPluginData(LEGACY_KEY_FINGERPRINT));
        migrated++;
        return; // an icon's internals carry no tags of their own
      }
    }

    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) walk(child);
    }
  };

  for (const page of figma.root.children) walk(page);
  return { migrated, alreadyShared };
}

migrate()
  .then(({ migrated, alreadyShared }) => {
    const message =
      migrated > 0
        ? `✅ Recovered ${migrated} icon${migrated === 1 ? "" : "s"}${alreadyShared > 0 ? ` (${alreadyShared} already fine)` : ""}`
        : alreadyShared > 0
          ? `Nothing to do — all ${alreadyShared} tracked icons are already recovered`
          : "No Iconsource tags found under this plugin id — try the other id (see scripts/build-rescue.mjs)";

    figma.notify(message, { timeout: 8000 });
    figma.closePlugin(message);
  })
  .catch((error) => {
    console.error(error);
    figma.closePlugin(`Recovery failed: ${error instanceof Error ? error.message : "unknown error"}`);
  });
