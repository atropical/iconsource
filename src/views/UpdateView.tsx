import React, { useEffect, useState } from "react";
import { Text, Link, Flex, Button } from "figma-kit";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { getIconSvg, resolveIconPreview } from "../utils/iconify";
import { hashString } from "../utils/iconTracking";
import { MessageTypes, PluginMessage, TrackedIconNode } from "../types.d";

export const UpdateView: React.FC = () => {
  const [tracked, setTracked] = useState<TrackedIconNode[]>([]);
  const [checking, setChecking] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    parent.postMessage({ pluginMessage: { type: MessageTypes.SCAN_TRACKED_REQUEST } as PluginMessage }, "*");

    const handler = async ({ data: { pluginMessage } }: { data: { pluginMessage: PluginMessage } }) => {
      if (pluginMessage.type === MessageTypes.SCAN_TRACKED_RESULT && pluginMessage.tracked) {
        const list = pluginMessage.tracked;
        setChecking(true);
        const withStatus = await Promise.all(
          list.map(async (item) => {
            try {
              const liveSvg = await getIconSvg(item.prefix, item.iconName);
              return { ...item, updateAvailable: hashString(liveSvg) !== item.svgHash };
            } catch {
              return item; // unreachable/renamed icon — leave status unknown, not blocking
            }
          })
        );
        setTracked(withStatus);
        setChecking(false);
      } else if (pluginMessage.type === MessageTypes.UPDATE_ICON_RESULT) {
        setUpdatingId(null);
        parent.postMessage({ pluginMessage: { type: MessageTypes.SCAN_TRACKED_REQUEST } as PluginMessage }, "*");
      } else if (pluginMessage.type === MessageTypes.UPDATE_ERROR) {
        setUpdatingId(null);
        setError(pluginMessage.error ?? "Update failed");
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const updateOne = async (item: TrackedIconNode) => {
    setError(null);
    setUpdatingId(item.nodeId);
    try {
      const preview = await resolveIconPreview(item.prefix, item.iconName);
      parent.postMessage(
        {
          pluginMessage: {
            type: MessageTypes.UPDATE_ICON_REQUEST,
            nodeId: item.nodeId,
            icon: preview,
            updatedSvg: preview.svg,
          } as PluginMessage,
        },
        "*"
      );
    } catch (e) {
      setUpdatingId(null);
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const jumpTo = (nodeId: string) => {
    parent.postMessage({ pluginMessage: { type: MessageTypes.SELECT_NODE_REQUEST, nodeId } as PluginMessage }, "*");
  };

  const outdated = tracked.filter((t) => t.updateAvailable);

  return (
    <PluginDialogShell>
      <Flex direction="column" gap="3" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Text weight="strong">Icons in this document</Text>
        {error && <Text style={{ color: "var(--figma-color-text-danger)" }}>{error}</Text>}
        {checking && <Text style={{ color: "var(--figma-color-text-secondary)" }}>Checking for updates…</Text>}

        {!checking && tracked.length === 0 && (
          <Text style={{ color: "var(--figma-color-text-secondary)" }}>
            No Icontopia-imported icons found in this document yet.
          </Text>
        )}

        {!checking && tracked.length > 0 && (
          <Text style={{ color: "var(--figma-color-text-secondary)" }}>
            {outdated.length === 0 ? "Everything is up to date." : `${outdated.length} icon(s) have updates available.`}
          </Text>
        )}

        {tracked.map((item) => (
          <Flex
            key={item.nodeId}
            justify="between"
            align="center"
            gap="2"
            style={{ padding: "0.5rem 0.75rem", border: "1px solid var(--figma-color-border)", borderRadius: 6 }}
          >
            <Flex direction="column" gap="1">
              <Link onClick={() => jumpTo(item.nodeId)} style={{ cursor: "pointer" }}>{item.name}</Link>
              <Text style={{ color: "var(--figma-color-text-secondary)" }}>{item.icon}</Text>
            </Flex>
            {item.updateAvailable ? (
              <Button onClick={() => updateOne(item)} disabled={updatingId === item.nodeId}>
                {updatingId === item.nodeId ? "Updating…" : "Update"}
              </Button>
            ) : (
              <Text style={{ color: "var(--figma-color-text-secondary)" }}>Up to date</Text>
            )}
          </Flex>
        ))}
      </Flex>
    </PluginDialogShell>
  );
};
