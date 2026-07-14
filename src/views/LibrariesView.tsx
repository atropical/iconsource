import React, { useEffect, useMemo, useState } from "react";
import { Text, Input, Link, Flex } from "figma-kit";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { getAllCollections, groupLibraries } from "../utils/iconify";
import { IconLibrary } from "../types.d";

interface LibrariesViewProps {
  onSelect: (library: IconLibrary) => void;
}

export const LibrariesView: React.FC<LibrariesViewProps> = ({ onSelect }) => {
  const [libraries, setLibraries] = useState<IconLibrary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAllCollections()
      .then((raw) => setLibraries(groupLibraries(raw)))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load icon libraries"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return libraries;
    return libraries.filter(
      (lib) => lib.displayName.toLowerCase().includes(q) || lib.author.name?.toLowerCase().includes(q)
    );
  }, [libraries, query]);

  return (
    <PluginDialogShell>
      <Flex direction="column" gap="3" style={{ flex: 1, minHeight: 0 }}>
        <Input
          placeholder="Search libraries (e.g. Phosphor, Material, Feather)…"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        />

        {loading && <Text style={{ color: "var(--figma-color-text-secondary)" }}>Loading icon libraries…</Text>}
        {error && <Text style={{ color: "var(--figma-color-text-danger)" }}>{error}</Text>}

        <Flex direction="column" gap="2" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {filtered.map((lib) => (
            <button
              key={lib.id}
              onClick={() => onSelect(lib)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                textAlign: "left",
                padding: "0.6rem 0.75rem",
                border: "1px solid var(--figma-color-border)",
                borderRadius: 6,
                background: "var(--figma-color-bg)",
                cursor: "pointer",
              }}
            >
              <Flex justify="between" align="center">
                <Text weight="strong">{lib.displayName}</Text>
                <Text style={{ color: "var(--figma-color-text-secondary)" }}>
                  {lib.totalIcons.toLocaleString()} icons · {lib.styles.length} style{lib.styles.length === 1 ? "" : "s"}
                </Text>
              </Flex>
              <Flex gap="1" align="center">
                {lib.sampleIcons.map((icon) => (
                  <img
                    key={icon}
                    src={`https://api.iconify.design/${icon.replace(":", "/")}.svg?color=currentColor`}
                    width={20}
                    height={20}
                    alt=""
                  />
                ))}
              </Flex>
              <Text style={{ color: "var(--figma-color-text-secondary)" }}>
                {lib.author.name}
                {" · "}
                {lib.license.url ? (
                  <Link href={lib.license.url} target="_blank" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    {lib.license.title}
                  </Link>
                ) : (
                  lib.license.title
                )}
              </Text>
            </button>
          ))}
        </Flex>
      </Flex>
    </PluginDialogShell>
  );
};
