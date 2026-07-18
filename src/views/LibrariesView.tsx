import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, Input, Link, Flex, SegmentedControl } from "figma-kit";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { IconGlyph } from "../components/IconGlyph";
import { LibraryCardSkeleton } from "../components/LibraryCardSkeleton";
import { usePrefs } from "../hooks/usePrefs";
import { getAllCollections, groupLibraries } from "../utils/iconify";
import { IconLibrary } from "../types.d";

interface LibrariesViewProps {
  onSelect: (library: IconLibrary) => void;
}

type SortMode = "popular" | "az" | "most-icons";

const PAGE_SIZE = 20;
const SKELETON_COUNT = 8;

export const LibrariesView: React.FC<LibrariesViewProps> = ({ onSelect }) => {
  const { prefs, loaded: prefsLoaded, setPref } = usePrefs();
  const [libraries, setLibraries] = useState<IconLibrary[]>([]);
  const [query, setQuery] = useState("");
  const [license, setLicense] = useState("All");
  const [sortMode, setSortModeState] = useState<SortMode>("popular");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    getAllCollections(controller.signal)
      .then((raw) => setLibraries(groupLibraries(raw))) // already ranked popular-first
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load icon libraries");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  // Adopt the saved sort order once prefs load — a beat after mount, so
  // this can't just be the useState initializer above.
  useEffect(() => {
    if (prefsLoaded && prefs.librarySortOrder) setSortModeState(prefs.librarySortOrder);
  }, [prefsLoaded, prefs.librarySortOrder]);

  const setSortMode = (mode: SortMode) => {
    setSortModeState(mode);
    setPref("librarySortOrder", mode);
  };

  const licenses = useMemo(
    () => Array.from(new Set(libraries.map((l) => l.license.title))).sort((a, b) => a.localeCompare(b)),
    [libraries]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = libraries;
    if (q) {
      list = list.filter(
        (lib) => lib.displayName.toLowerCase().includes(q) || lib.author.name?.toLowerCase().includes(q)
      );
    }
    if (license !== "All") list = list.filter((lib) => lib.license.title === license);

    if (sortMode === "az") list = [...list].sort((a, b) => a.displayName.localeCompare(b.displayName));
    else if (sortMode === "most-icons") list = [...list].sort((a, b) => b.totalIcons - a.totalIcons);
    // "popular" keeps the order groupLibraries already produced

    return list;
  }, [libraries, query, license, sortMode]);

  useEffect(() => setVisibleCount(PAGE_SIZE), [query, license, sortMode]);

  const visibleLibraries = filtered.slice(0, visibleCount);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length));
    }
  };

  return (
    <PluginDialogShell>
      <Flex direction="column" gap="3" style={{ flex: 1, minHeight: 0 }}>
        <Input
          placeholder="Search libraries (e.g. Phosphor, Material, Feather)…"
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        />

        <Flex gap="2" align="center">
          <SegmentedControl.Root value={sortMode} onValueChange={(v: string) => v && setSortMode(v as SortMode)} fullWidth>
            <SegmentedControl.Item value="popular"><SegmentedControl.Text>Popular</SegmentedControl.Text></SegmentedControl.Item>
            <SegmentedControl.Item value="az"><SegmentedControl.Text>A→Z</SegmentedControl.Text></SegmentedControl.Item>
            <SegmentedControl.Item value="most-icons"><SegmentedControl.Text>Most icons</SegmentedControl.Text></SegmentedControl.Item>
          </SegmentedControl.Root>
          <select
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            style={{
              background: "var(--figma-color-bg-secondary)",
              border: "1px solid var(--figma-color-border)",
              borderRadius: 6,
              color: "var(--figma-color-text)",
              padding: "0 0.4rem",
              height: "100%",
              maxWidth: 150,
              flexShrink: 0,
              textOverflow: "ellipsis",
            }}
          >
            <option value="All">All licenses</option>
            {licenses.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </Flex>

        {error && <Text style={{ color: "var(--figma-color-text-danger)" }}>{error}</Text>}

        <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Flex direction="column" gap="2">
            {loading &&
              Array.from({ length: SKELETON_COUNT }).map((_, i) => <LibraryCardSkeleton key={i} />)}

            {!loading &&
              visibleLibraries.map((lib) => (
                <button
                  key={lib.id}
                  onClick={() => onSelect(lib)}
                  className="iconsource-card"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    textAlign: "left",
                    padding: "0.6rem 0.75rem",
                    border: "1px solid var(--figma-color-border)",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  <Flex justify="between" align="center">
                    <Text weight="strong">{lib.displayName}</Text>
                    <Text style={{ color: "var(--figma-color-text-secondary)" }}>
                      {lib.totalIcons.toLocaleString()} icons · {lib.styles.length} style{lib.styles.length === 1 ? "" : "s"}
                    </Text>
                  </Flex>
                  <Flex gap="2" align="center" wrap="wrap">
                    {lib.sampleIcons.map((icon) => (
                      <IconGlyph key={icon} icon={icon} size={26} color="var(--figma-color-icon)" />
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

            {!loading && visibleCount < filtered.length && <LibraryCardSkeleton />}
          </Flex>
        </div>
      </Flex>
    </PluginDialogShell>
  );
};
