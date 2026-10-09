import React, { useEffect, useRef, useState } from "react";
import { Text, Link, Flex, Button } from "figma-kit";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { ImportOptionsControls } from "../components/ImportOptionsControls";
import { fetchIconData, fingerprintFor, getAllCollections } from "../utils/iconify";
import { IconImportOptions, MessageTypes, PluginMessage, TrackedIconNode, TrackedLibraryGroup } from "../types.d";

export const UpdateView: React.FC = () => {
  const [groups, setGroups] = useState<TrackedLibraryGroup[]>([]);
  const [checking, setChecking] = useState(true);
  const [updatingPrefix, setUpdatingPrefix] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  // Options being edited per library, before "Apply" rebuilds its icons.
  const [draftOptions, setDraftOptions] = useState<Record<string, IconImportOptions>>({});

  // Every fetch this view kicks off (collection metadata, per-icon SVG data)
  // registers its controller here so it can be aborted in one shot if the
  // user navigates away or the plugin closes mid-request.
  const controllersRef = useRef(new Set<AbortController>());
  const trackedFetch = () => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    return controller;
  };

  useEffect(() => {
    return () => {
      for (const controller of controllersRef.current) controller.abort();
    };
  }, []);

  useEffect(() => {
    parent.postMessage({ pluginMessage: { type: MessageTypes.SCAN_TRACKED_REQUEST } as PluginMessage }, "*");

    const handler = async ({ data: { pluginMessage } }: { data: { pluginMessage: PluginMessage } }) => {
      if (pluginMessage.type === MessageTypes.SCAN_TRACKED_RESULT && pluginMessage.tracked) {
        setChecking(true);
        try {
          setGroups(await buildGroups(pluginMessage.tracked));
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof Error ? e.message : "Failed to check for updates");
        } finally {
          setChecking(false);
        }
      } else if (pluginMessage.type === MessageTypes.SCAN_TRACKED_ERROR) {
        setChecking(false);
        setError(pluginMessage.error ?? "Failed to check for updates");
      } else if (pluginMessage.type === MessageTypes.UPDATE_PROGRESS) {
        setProgress({ done: pluginMessage.imported ?? 0, total: pluginMessage.total ?? 0 });
      } else if (pluginMessage.type === MessageTypes.UPDATE_RESULT) {
        setUpdatingPrefix(null);
        setDraftOptions({});
        parent.postMessage({ pluginMessage: { type: MessageTypes.SCAN_TRACKED_REQUEST } as PluginMessage }, "*");
      } else if (pluginMessage.type === MessageTypes.UPDATE_ERROR) {
        setUpdatingPrefix(null);
        setError(pluginMessage.error ?? "Update failed");
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const buildGroups = async (tracked: TrackedIconNode[]): Promise<TrackedLibraryGroup[]> => {
    const byPrefix = new Map<string, TrackedIconNode[]>();
    for (const item of tracked) {
      const list = byPrefix.get(item.prefix) ?? [];
      list.push(item);
      byPrefix.set(item.prefix, list);
    }

    const controller = trackedFetch();
    const collections = await getAllCollections(controller.signal);

    return Array.from(byPrefix.entries()).map(([prefix, icons]) => {
      const info = collections[prefix];
      const currentFingerprint = info ? fingerprintFor(info) : undefined;
      const importedFingerprint = icons[0]?.libraryFingerprint ?? "";

      return {
        prefix,
        icons,
        importedFingerprint,
        currentFingerprint,
        updateAvailable: currentFingerprint !== undefined && currentFingerprint !== importedFingerprint,
        palette: info?.palette,
      };
    });
  };

  /**
   * Re-fetch a library's icons and rebuild them in place. A plain update
   * only touches icons whose SVG changed; passing `options` forces every
   * icon to be rebuilt with them, which is how outline/flatten get applied
   * to (or removed from) icons that were imported without them.
   */
  const updateGroup = async (group: TrackedLibraryGroup, options?: IconImportOptions) => {
    if (!group.currentFingerprint) return;
    setError(null);
    setUpdatingPrefix(group.prefix);
    setProgress({ done: 0, total: group.icons.length });

    try {
      const controller = trackedFetch();
      const names = group.icons.map((i) => i.iconName);
      const icons = await fetchIconData(group.prefix, names, (done, total) => setProgress({ done, total }), 50, 6, controller.signal);
      if (controller.signal.aborted) return;

      parent.postMessage(
        {
          pluginMessage: {
            type: MessageTypes.UPDATE_LIBRARY_REQUEST,
            prefix: group.prefix,
            icons,
            libraryFingerprint: group.currentFingerprint,
            options,
            force: options !== undefined,
          } as PluginMessage,
        },
        "*"
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setUpdatingPrefix(null);
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  /** Clear the tags on a library's icons, e.g. leftovers of a library deleted by hand. The icons stay on the canvas. */
  const untrack = (group: TrackedLibraryGroup) => {
    const confirmed = window.confirm(
      `Stop tracking ${group.icons.length} icon${group.icons.length === 1 ? "" : "s"} from "${group.prefix}"?\n\nThe icons stay in the document but will no longer be checked for updates.`
    );
    if (!confirmed) return;
    setChecking(true);
    parent.postMessage({ pluginMessage: { type: MessageTypes.UNTRACK_LIBRARY_REQUEST, prefix: group.prefix } as PluginMessage }, "*");
  };

  const jumpTo = (nodeId: string) => {
    parent.postMessage({ pluginMessage: { type: MessageTypes.SELECT_NODE_REQUEST, nodeId } as PluginMessage }, "*");
  };

  // A library's options as imported. Icons from separate imports can differ;
  // an option counts as on only when every icon in the library has it.
  const currentOptionsOf = (group: TrackedLibraryGroup): IconImportOptions => ({
    outline: group.icons.every((i) => i.options.outline),
    flatten: group.icons.every((i) => i.options.flatten),
    // Shared only when every icon has the same colour; otherwise shown as original.
    color: group.icons.every((i) => JSON.stringify(i.options.color ?? null) === JSON.stringify(group.icons[0].options.color ?? null))
      ? group.icons[0].options.color
      : undefined,
  });

  const outdated = groups.filter((g) => g.updateAvailable);

  return (
    <PluginDialogShell>
      <Flex direction="column" gap="3" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Text weight="strong">Libraries imported into this document</Text>
        {error && <Text style={{ color: "var(--figma-color-text-danger)" }}>{error}</Text>}
        {checking && <Text style={{ color: "var(--figma-color-text-secondary)" }}>Checking for updates…</Text>}

        {!checking && groups.length === 0 && (
          <Text style={{ color: "var(--figma-color-text-secondary)" }}>
            No Iconsource-imported icons found in this document yet.
          </Text>
        )}

        {!checking && groups.length > 0 && (
          <Text style={{ color: "var(--figma-color-text-secondary)" }}>
            {outdated.length === 0 ? "Everything is up to date." : `${outdated.length} librar${outdated.length === 1 ? "y has" : "ies have"} updates available.`}
          </Text>
        )}

        {groups.map((group) => (
          <Flex
            key={group.prefix}
            direction="column"
            gap="2"
            style={{ padding: "0.6rem 0.75rem", border: "1px solid var(--figma-color-border)", borderRadius: 6 }}
          >
            <Flex justify="between" align="center">
              <Flex direction="column" gap="1">
                <Text weight="strong">{group.prefix}</Text>
                <Text style={{ color: "var(--figma-color-text-secondary)" }}>{group.icons.length} icon{group.icons.length === 1 ? "" : "s"} in this document</Text>
              </Flex>
              <Flex gap="2" align="center">
              <Button variant="text" onClick={() => untrack(group)} disabled={updatingPrefix !== null}>
                Stop tracking
              </Button>
              {group.updateAvailable ? (
                <Button onClick={() => updateGroup(group)} disabled={updatingPrefix === group.prefix}>
                  {updatingPrefix === group.prefix ? `Updating… ${progress.done}/${progress.total}` : "Update library"}
                </Button>
              ) : (
                <Text style={{ color: "var(--figma-color-text-secondary)" }}>Up to date</Text>
              )}
              </Flex>
            </Flex>
            {(() => {
              const current = currentOptionsOf(group);
              const draft = draftOptions[group.prefix] ?? current;
              const effective: IconImportOptions = group.palette ? { outline: draft.outline } : draft;
              const changed = !!effective.outline !== !!current.outline
                || !!effective.flatten !== !!current.flatten
                || JSON.stringify(effective.color ?? null) !== JSON.stringify(current.color ?? null);
              return (
                <Flex justify="between" align="center" gap="2" wrap="wrap">
                  <ImportOptionsControls
                    idPrefix={`restyle-${group.prefix}`}
                    value={draft}
                    onChange={(next) => setDraftOptions((prev) => ({ ...prev, [group.prefix]: next }))}
                    palette={group.palette}
                    disabled={updatingPrefix !== null}
                  />
                  {(changed || updatingPrefix === group.prefix) && (
                    <Button variant="secondary" onClick={() => updateGroup(group, effective)} disabled={updatingPrefix !== null || !group.currentFingerprint}>
                      {updatingPrefix === group.prefix
                        ? `Applying… ${progress.done}/${progress.total}`
                        : `Apply to ${group.icons.length} icon${group.icons.length === 1 ? "" : "s"}`}
                    </Button>
                  )}
                </Flex>
              );
            })()}
            <Flex gap="1" wrap="wrap">
              {group.icons.slice(0, 12).map((icon) => (
                <Link key={icon.nodeId} onClick={() => jumpTo(icon.nodeId)} style={{ cursor: "pointer" }}>
                  {icon.iconName}
                </Link>
              ))}
              {group.icons.length > 12 && (
                <Text style={{ color: "var(--figma-color-text-secondary)" }}>+{group.icons.length - 12} more</Text>
              )}
            </Flex>
          </Flex>
        ))}
      </Flex>
    </PluginDialogShell>
  );
};
