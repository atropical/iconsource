import React, { useEffect, useState } from "react";
import { Text, Input, Link, Flex, Button } from "figma-kit";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { browseIconsInPrefix, fetchIconData, listAllIconsInPrefix, searchIconsInPrefix } from "../utils/iconify";
import { IconLibrary, IconSearchResult, MessageTypes, PluginMessage } from "../types.d";

interface LibraryDetailViewProps {
  library: IconLibrary;
  onBack: () => void;
}

const LARGE_LIBRARY_THRESHOLD = 300;

export const LibraryDetailView: React.FC<LibraryDetailViewProps> = ({ library, onBack }) => {
  const [styleIndex, setStyleIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IconSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [phase, setPhase] = useState<"fetching" | "inserting" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const style = library.styles[styleIndex];

  useEffect(() => {
    setLoading(true);
    setError(null);
    const run = query.trim()
      ? searchIconsInPrefix(style.prefix, query)
      : browseIconsInPrefix(style.prefix);

    run
      .then(setResults)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load icons"))
      .finally(() => setLoading(false));
  }, [style.prefix, query]);

  useEffect(() => {
    const handler = ({ data: { pluginMessage } }: { data: { pluginMessage: PluginMessage } }) => {
      if (pluginMessage.type === MessageTypes.IMPORT_PROGRESS) {
        setPhase("inserting");
        setProgress({ done: pluginMessage.imported ?? 0, total: pluginMessage.total ?? 0 });
      } else if (pluginMessage.type === MessageTypes.IMPORT_RESULT) {
        setImporting(false);
        setPhase(null);
      } else if (pluginMessage.type === MessageTypes.IMPORT_ERROR) {
        setImporting(false);
        setPhase(null);
        setError(pluginMessage.error ?? "Import failed");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const importStyle = async () => {
    const confirmed = window.confirm(
      style.total > LARGE_LIBRARY_THRESHOLD
        ? `Import all ${style.total.toLocaleString()} icons from "${library.displayName} — ${style.label}"?\n\nThis creates ${style.total.toLocaleString()} nodes on the canvas and may take a while.`
        : `Import all ${style.total.toLocaleString()} icons from "${library.displayName} — ${style.label}"?`
    );
    if (!confirmed) return;

    setError(null);
    setImporting(true);
    setPhase("fetching");
    setProgress({ done: 0, total: style.total });

    try {
      const names = await listAllIconsInPrefix(style.prefix);
      const icons = await fetchIconData(style.prefix, names, (done, total) => setProgress({ done, total }));

      setPhase("inserting");
      parent.postMessage(
        {
          pluginMessage: {
            type: MessageTypes.IMPORT_ICONS_REQUEST,
            icons,
            libraryFingerprint: `${style.version ?? "v0"}:${style.total}`,
          } as PluginMessage,
        },
        "*"
      );
    } catch (e) {
      setImporting(false);
      setPhase(null);
      setError(e instanceof Error ? e.message : "Import failed");
    }
  };

  return (
    <PluginDialogShell>
      <Flex direction="column" gap="3" style={{ flex: 1, minHeight: 0 }}>
        <Flex justify="between" align="center">
          <Link onClick={onBack} style={{ cursor: "pointer" }}>← Libraries</Link>
          {library.repo && <Link href={library.repo} target="_blank">Repo ↗</Link>}
        </Flex>

        <Flex direction="column" gap="1">
          <Text weight="strong">{library.displayName}</Text>
          <Text style={{ color: "var(--figma-color-text-secondary)" }}>
            {library.author.name} · {library.license.url ? <Link href={library.license.url} target="_blank">{library.license.title}</Link> : library.license.title}
          </Text>
        </Flex>

        {library.styles.length > 1 && (
          <Flex gap="1" wrap="wrap">
            {library.styles.map((s, i) => (
              <button
                key={s.prefix}
                onClick={() => { setStyleIndex(i); setQuery(""); }}
                style={{
                  padding: "0.3rem 0.6rem",
                  borderRadius: 999,
                  border: i === styleIndex ? "1px solid var(--figma-color-border-selected)" : "1px solid var(--figma-color-border)",
                  background: i === styleIndex ? "var(--figma-color-bg-selected)" : "var(--figma-color-bg-secondary)",
                  cursor: "pointer",
                }}
              >
                {s.label}
              </button>
            ))}
          </Flex>
        )}

        <Input
          placeholder={`Search within ${style.label}…`}
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        />

        {error && <Text style={{ color: "var(--figma-color-text-danger)" }}>{error}</Text>}

        <Flex wrap="wrap" gap="2" style={{ flex: 1, minHeight: 0, overflowY: "auto", alignContent: "flex-start" }}>
          {loading && <Text style={{ color: "var(--figma-color-text-secondary)" }}>Loading…</Text>}
          {!loading && results.length === 0 && <Text style={{ color: "var(--figma-color-text-secondary)" }}>No icons found.</Text>}
          {results.map((hit) => (
            <div
              key={hit.icon}
              title={hit.icon}
              style={{
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid var(--figma-color-border)",
                borderRadius: 6,
                background: "var(--figma-color-bg-secondary)",
              }}
            >
              <img src={`https://api.iconify.design/${hit.prefix}/${hit.name}.svg?color=currentColor`} width={20} height={20} alt={hit.icon} />
            </div>
          ))}
        </Flex>

        <Button onClick={importStyle} disabled={importing}>
          {importing
            ? phase === "fetching"
              ? `Fetching icons… ${progress.done}/${progress.total}`
              : `Inserting icons… ${progress.done}/${progress.total}`
            : `Import all ${style.total.toLocaleString()} icons (${style.label})`}
        </Button>
      </Flex>
    </PluginDialogShell>
  );
};
