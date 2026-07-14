import React, { useEffect, useState } from "react";
import { Text, Input, Link, Flex, Button } from "figma-kit";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { searchIcons, resolveIconPreview } from "../utils/iconify";
import { IconPreview, IconSearchResult, MessageTypes, PluginMessage } from "../types.d";

const THUMB = (prefix: string, name: string) =>
  `https://api.iconify.design/${prefix}/${name}.svg?color=currentColor`;

export const BrowseView: React.FC = () => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IconSearchResult[]>([]);
  const [selected, setSelected] = useState<IconPreview | null>(null);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        setResults(await searchIcons(query));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handler = ({ data: { pluginMessage } }: { data: { pluginMessage: PluginMessage } }) => {
      if (pluginMessage.type === MessageTypes.IMPORT_ICON_RESULT) {
        setImporting(false);
      } else if (pluginMessage.type === MessageTypes.IMPORT_ERROR) {
        setImporting(false);
        setError(pluginMessage.error ?? "Import failed");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const selectIcon = async (hit: IconSearchResult) => {
    setError(null);
    try {
      setSelected(await resolveIconPreview(hit.prefix, hit.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load icon");
    }
  };

  const importSelected = () => {
    if (!selected) return;
    setImporting(true);
    parent.postMessage(
      { pluginMessage: { type: MessageTypes.IMPORT_ICON_REQUEST, icon: selected } as PluginMessage },
      "*"
    );
  };

  return (
    <PluginDialogShell>
      <Flex direction="column" gap="3" style={{ flex: 1, minHeight: 0 }}>
        <Input
          placeholder="Search icons (e.g. arrow, home, user)…"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        />

        {error && <Text style={{ color: "var(--figma-color-text-danger)" }}>{error}</Text>}

        {selected && (
          <>
            <Flex direction="column" gap="2" style={{ padding: "0.75rem", border: "1px solid var(--figma-color-border)", borderRadius: 6 }}>
              <Flex gap="3" align="center">
                <img src={THUMB(selected.prefix, selected.name)} width={40} height={40} alt={selected.icon} />
                <Flex direction="column" gap="1">
                  <Text weight="strong">{selected.icon}</Text>
                  <Text style={{ color: "var(--figma-color-text-secondary)" }}>
                    {selected.collection.name} · <Link target="_blank" href={selected.collection.license.url}>{selected.collection.license.title}</Link>
                    {selected.collection.repo && (
                      <> · <Link target="_blank" href={selected.collection.repo}>Repo ↗</Link></>
                    )}
                  </Text>
                </Flex>
              </Flex>
              <Button onClick={importSelected} disabled={importing}>
                {importing ? "Importing…" : "Import icon"}
              </Button>
            </Flex>
          </>
        )}

        <Flex
          wrap="wrap"
          gap="2"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", alignContent: "flex-start" }}
        >
          {searching && <Text style={{ color: "var(--figma-color-text-secondary)" }}>Searching…</Text>}
          {!searching && query && results.length === 0 && (
            <Text style={{ color: "var(--figma-color-text-secondary)" }}>No icons found.</Text>
          )}
          {results.map((hit) => (
            <button
              key={hit.icon}
              onClick={() => selectIcon(hit)}
              title={hit.icon}
              style={{
                width: 44,
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: selected?.icon === hit.icon ? "1px solid var(--figma-color-border-selected)" : "1px solid var(--figma-color-border)",
                borderRadius: 6,
                background: "var(--figma-color-bg-secondary)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <img src={THUMB(hit.prefix, hit.name)} width={24} height={24} alt={hit.icon} />
            </button>
          ))}
        </Flex>
      </Flex>
    </PluginDialogShell>
  );
};
