import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, Input, Link, Flex, Button, SegmentedControl, Tabs } from "figma-kit";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { IconGlyph } from "../components/IconGlyph";
import { detectNameStyles, fetchIconData, getPrefixIndex, PrefixIndex } from "../utils/iconify";
import { IconLibrary, MessageTypes, PluginMessage } from "../types.d";

interface LibraryDetailViewProps {
  library: IconLibrary;
  onBack: () => void;
}

/** One navigable style tab. Either a real sibling Iconify prefix (kind "prefix", e.g. Material Symbols Light) or a name-filtered subset of a single prefix (kind "name", e.g. Phosphor's "Bold" weight, which isn't its own collection — see detectNameStyles). Unified so the UI never has to choose between a toggle group and a select depending on which mechanism applies. */
type EffectiveTab =
  | { kind: "prefix"; key: string; label: string; prefix: string; total: number; version?: string }
  | { kind: "name"; key: string; label: string; total: number };

const LARGE_LIBRARY_THRESHOLD = 300;
const PAGE_SIZE = 120;
const ICON_BOX = 48;
const ICON_SIZE = 26;
const STICKY_BG = "var(--figma-color-bg)";

export const LibraryDetailView: React.FC<LibraryDetailViewProps> = ({ library, onBack }) => {
  const isMultiPrefix = library.styles.length > 1;
  // The single real Iconify prefix everything is fetched from. For a
  // multi-prefix library this changes when the user switches tabs; for a
  // name-encoded library (Phosphor, classic Material Icons, ...) it's fixed
  // — switching tabs there just re-filters the one already-loaded index.
  const [activePrefix, setActivePrefix] = useState(library.styles[0].prefix);
  const [activeTabKey, setActiveTabKey] = useState<string>(library.styles[0].prefix);

  const [index, setIndex] = useState<PrefixIndex | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sortOrder, setSortOrder] = useState<"az" | "za">("az");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [phase, setPhase] = useState<"fetching" | "inserting" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const importAbortRef = useRef<AbortController | null>(null);

  // Abort any in-flight icon-data fetch if the user navigates away
  // (back to the library list, or the plugin closes) mid-import.
  useEffect(() => () => importAbortRef.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    setIndexLoading(true);
    setError(null);
    setQuery("");
    setCategory("All");
    setVisibleCount(PAGE_SIZE);
    getPrefixIndex(activePrefix, controller.signal)
      .then(setIndex)
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load icons");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIndexLoading(false);
      });
    return () => controller.abort();
  }, [activePrefix]);

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

  // Only relevant for libraries with a single Iconify-level prefix — real
  // sibling prefixes already give us tabs directly.
  const nameStyles = useMemo(
    () => (index && !isMultiPrefix ? detectNameStyles(index.names, activePrefix) : null),
    [index, isMultiPrefix, activePrefix]
  );

  const tabs: EffectiveTab[] | null = useMemo(() => {
    if (isMultiPrefix) {
      return library.styles.map((s) => ({ kind: "prefix" as const, key: s.prefix, label: s.label, prefix: s.prefix, total: s.total, version: s.version }));
    }
    if (!nameStyles) return null;
    const counts = new Map<string, number>();
    for (const label of nameStyles.styleByName.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
    return nameStyles.styles.map((label) => ({ kind: "name" as const, key: label, label, total: counts.get(label) ?? 0 }));
  }, [isMultiPrefix, library.styles, nameStyles]);

  // Default to the first tab (never an "all styles combined" view) once tabs
  // become known — for name-encoded libraries that's only after the index
  // (and therefore detection) has loaded.
  useEffect(() => {
    if (tabs && tabs.length > 0 && !tabs.some((t) => t.key === activeTabKey)) {
      setActiveTabKey(tabs[0].key);
    }
  }, [tabs, activeTabKey]);

  // Libraries with exactly one real style (no sibling prefixes, no detected
  // name-encoded variants) have no tabs to show, but still need a stand-in
  // "active style" so import/labels/counts work the same way as everywhere
  // else — it's just the whole prefix.
  const activeTab: EffectiveTab | null = useMemo(() => {
    if (tabs) return tabs.find((t) => t.key === activeTabKey) ?? tabs[0] ?? null;
    if (!index) return null;
    return { kind: "prefix", key: activePrefix, label: library.styles[0].label, prefix: activePrefix, total: index.names.length };
  }, [tabs, activeTabKey, index, activePrefix, library.styles]);

  // Iconify's own version string for whatever the active prefix is — looked
  // up from library.styles rather than activeTab since a name-kind tab
  // (Phosphor "Bold", classic Material Icons "Outline", ...) doesn't carry
  // its own version, it's a filtered subset of the one underlying prefix.
  const activeVersion = library.styles.find((s) => s.prefix === activePrefix)?.version;

  const selectTab = (key: string) => {
    setActiveTabKey(key);
    const tab = tabs?.find((t) => t.key === key);
    if (tab?.kind === "prefix" && tab.prefix !== activePrefix) {
      setActivePrefix(tab.prefix);
    }
  };

  // The full name list for whichever single style is currently active,
  // before search/category filtering — this is what "import" uses, so a
  // search query never narrows what gets imported.
  const namesInActiveStyle = useMemo(() => {
    if (!index) return [];
    if (!isMultiPrefix && nameStyles && activeTab?.kind === "name") {
      return index.names.filter((n) => nameStyles.styleByName.get(n) === activeTab.label);
    }
    return index.names;
  }, [index, isMultiPrefix, nameStyles, activeTab]);

  // The whole prefix's icon count, as Iconify's /collections reports it —
  // not namesInActiveStyle.length, which for a name-kind tab is only the
  // filtered subset. This is what fingerprintFor(info) also derives from,
  // so the two must be sourced the same way for the import fingerprint to
  // ever match a later "check for updates" comparison.
  const prefixTotal = library.styles.find((s) => s.prefix === activePrefix)?.total ?? namesInActiveStyle.length;

  const filteredNames = useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    let names = namesInActiveStyle;
    if (q) names = names.filter((n) => n.includes(q));
    if (category !== "All") names = names.filter((n) => index.categoryByName.get(n) === category);
    names = [...names].sort((a, b) => (sortOrder === "az" ? a.localeCompare(b) : b.localeCompare(a)));
    return names;
  }, [index, namesInActiveStyle, query, category, sortOrder]);

  useEffect(() => setVisibleCount(PAGE_SIZE), [query, category, sortOrder, activeTabKey]);

  const visibleNames = filteredNames.slice(0, visibleCount);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, filteredNames.length));
    }
  };

  const importStyle = async () => {
    if (!activeTab) return;
    const total = namesInActiveStyle.length;

    const confirmed = window.confirm(
      total > LARGE_LIBRARY_THRESHOLD
        ? `Import all ${total.toLocaleString()} icons from "${library.displayName} — ${activeTab.label}"?\n\nThis creates ${total.toLocaleString()} nodes on the canvas and may take a while.`
        : `Import all ${total.toLocaleString()} icons from "${library.displayName} — ${activeTab.label}"?`
    );
    if (!confirmed) return;

    setError(null);
    setImporting(true);
    setPhase("fetching");
    setProgress({ done: 0, total });

    const controller = new AbortController();
    importAbortRef.current = controller;

    try {
      const icons = await fetchIconData(activePrefix, namesInActiveStyle, (done, t) => setProgress({ done, total: t }), 50, 6, controller.signal);
      if (controller.signal.aborted) return;

      setPhase("inserting");
      parent.postMessage(
        {
          pluginMessage: {
            type: MessageTypes.IMPORT_ICONS_REQUEST,
            icons,
            // Must match what fingerprintFor(info) computes from Iconify's
            // live /collections data — the *whole prefix's* version+total,
            // not this style subset's — otherwise "Check for Updates"
            // compares against a number it can never equal (e.g. a
            // name-encoded style tab like Phosphor "Bold" only has ~1,500
            // of the prefix's ~9,000 icons) and reports an update
            // available immediately after a fresh import.
            libraryFingerprint: `${activeVersion ?? "v0"}:${prefixTotal}`,
          } as PluginMessage,
        },
        "*"
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setImporting(false);
      setPhase(null);
      setError(e instanceof Error ? e.message : "Import failed");
    }
  };

  return (
    <PluginDialogShell showFooter={false}>
      <Flex style={{ flex: 1, minHeight: 0 }}>
        {/* Main column: sticky breadcrumb/header at top, sticky import button at bottom, icon grid scrolls between them */}
        <Flex direction="column" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <div
            ref={scrollRef}
            onScroll={onScroll}
            style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative" }}
          >
            <Flex
              direction="column"
              gap="3"
              style={{ position: "sticky", top: 0, zIndex: 2, background: STICKY_BG, paddingBottom: "0.75rem" }}
            >
              <Flex justify="between" align="center">
                <Link onClick={onBack} style={{ cursor: "pointer" }}>← Libraries</Link>
                {library.repo && <Link href={library.repo} target="_blank">Repo ↗</Link>}
              </Flex>

              <Flex direction="column" gap="1">
                <Text weight="strong">{library.displayName}</Text>
                <Text style={{ color: "var(--figma-color-text-secondary)" }}>
                  {library.author.name} · {library.license.url ? <Link href={library.license.url} target="_blank">{library.license.title}</Link> : library.license.title}
                  {activeVersion && <> · v{activeVersion}</>}
                </Text>
              </Flex>

              {tabs && tabs.length > 1 && (
                <Tabs.Root value={activeTabKey} onValueChange={selectTab}>
                  <Tabs.List>
                    {tabs.map((t) => (
                      <Tabs.Trigger key={t.key} value={t.key}>{t.label}</Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </Tabs.Root>
              )}
              {!tabs && !isMultiPrefix && indexLoading && (
                <Text style={{ color: "var(--figma-color-text-secondary)" }}>Checking for styles…</Text>
              )}

              <Flex gap="2">
                <Input
                  placeholder={activeTab ? `Search within ${activeTab.label}…` : "Search…"}
                  value={query}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                  style={{ flex: 1 }}
                />
                {index && index.categories.length > 0 && (
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{
                      background: "var(--figma-color-bg-secondary)",
                      border: "1px solid var(--figma-color-border)",
                      borderRadius: 6,
                      color: "var(--figma-color-text)",
                      padding: "0 0.4rem",
                      maxWidth: 130,
                      flexShrink: 0,
                      textOverflow: "ellipsis",
                    }}
                  >
                    <option value="All">All categories</option>
                    {index.categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
                <SegmentedControl.Root value={sortOrder} onValueChange={(v: string) => v && setSortOrder(v as "az" | "za")}>
                  <SegmentedControl.Item value="az"><SegmentedControl.Text>A→Z</SegmentedControl.Text></SegmentedControl.Item>
                  <SegmentedControl.Item value="za"><SegmentedControl.Text>Z→A</SegmentedControl.Text></SegmentedControl.Item>
                </SegmentedControl.Root>
              </Flex>

              {error && <Text style={{ color: "var(--figma-color-text-danger)" }}>{error}</Text>}

              <Text style={{ color: "var(--figma-color-text-secondary)" }}>
                {indexLoading ? "Loading icon index…" : `${filteredNames.length.toLocaleString()} icon${filteredNames.length === 1 ? "" : "s"}`}
              </Text>
            </Flex>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {visibleNames.map((name) => {
                const icon = `${activePrefix}:${name}`;
                return (
                  <button
                    key={icon}
                    onClick={() => setSelected(icon)}
                    title={icon}
                    className="iconsource-icon-cell"
                    data-selected={selected === icon}
                    style={{
                      width: ICON_BOX,
                      height: ICON_BOX,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px solid var(--figma-color-border)",
                      borderRadius: 6,
                      background: "var(--figma-color-bg-secondary)",
                      cursor: "pointer",
                      padding: 0,
                      color: "var(--figma-color-icon)",
                    }}
                  >
                    <IconGlyph icon={icon} size={ICON_SIZE} />
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ position: "sticky", bottom: 0, background: STICKY_BG, paddingTop: "0.75rem" }}>
            <Button variant="primary" size="medium" fullWidth onClick={importStyle} disabled={importing || !activeTab}>
              {importing
                ? phase === "fetching"
                  ? `Fetching icons… ${progress.done}/${progress.total}`
                  : `Inserting icons… ${progress.done}/${progress.total}`
                : activeTab
                  ? `Import all ${namesInActiveStyle.length.toLocaleString()} icons (${activeTab.label})`
                  : "Loading…"}
            </Button>
          </div>
        </Flex>

        {/* Side panel: always-visible glyph specimen, like a typeface specimen sheet */}
        <Flex
          direction="column"
          align="center"
          justify="center"
          gap="3"
          style={{
            width: 260,
            flexShrink: 0,
            borderLeft: "1px solid var(--figma-color-border)",
            marginLeft: "1rem",
            paddingLeft: "1rem",
          }}
        >
          {selected ? (
            <>
              <div
                style={{
                  width: 140,
                  height: 140,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--figma-color-border)",
                  borderRadius: 8,
                  background: "var(--figma-color-bg-secondary)",
                }}
              >
                <IconGlyph icon={selected} size={84} color="var(--figma-color-icon)" />
              </div>
              <Flex direction="column" align="center" gap="1">
                <Text weight="strong">{selected.split(":")[1]}</Text>
                <Text style={{ color: "var(--figma-color-text-secondary)", wordBreak: "break-all", textAlign: "center" }}>{selected}</Text>
              </Flex>
            </>
          ) : (
            <Text style={{ color: "var(--figma-color-text-secondary)", textAlign: "center" }}>
              Click an icon to preview it here
            </Text>
          )}
        </Flex>
      </Flex>
    </PluginDialogShell>
  );
};
