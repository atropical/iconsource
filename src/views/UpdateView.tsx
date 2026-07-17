import React, { useEffect, useRef, useState } from "react";
import { Text, Link, Flex, Button } from "figma-kit";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { fetchIconData, fingerprintFor, getAllCollections } from "../utils/iconify";
import { MessageTypes, PluginMessage, TrackedIconNode, TrackedLibraryGroup } from "../types.d";

export const UpdateView: React.FC = () => {
  const [groups, setGroups] = useState<TrackedLibraryGroup[]>([]);
  const [checking, setChecking] = useState(true);
  const [updatingPrefix, setUpdatingPrefix] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

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
      };
    });
  };

  const updateGroup = async (group: TrackedLibraryGroup) => {
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

  const jumpTo = (nodeId: string) => {
    parent.postMessage({ pluginMessage: { type: MessageTypes.SELECT_NODE_REQUEST, nodeId } as PluginMessage }, "*");
  };

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
              {group.updateAvailable ? (
                <Button onClick={() => updateGroup(group)} disabled={updatingPrefix === group.prefix}>
                  {updatingPrefix === group.prefix ? `Updating… ${progress.done}/${progress.total}` : "Update library"}
                </Button>
              ) : (
                <Text style={{ color: "var(--figma-color-text-secondary)" }}>Up to date</Text>
              )}
            </Flex>
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
