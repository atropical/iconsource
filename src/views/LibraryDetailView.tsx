import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, Input, Link, Flex, Button, SegmentedControl } from "figma-kit";
import { PluginDialogShell } from "../components/PluginDialogShell";
import { IconGlyph } from "../components/IconGlyph";
import { detectNameStyles, fetchIconData, getPrefixIndex, PrefixIndex } from "../utils/iconify";
import { IconLibrary, MessageTypes, PluginMessage } from "../types.d";

interface LibraryDetailViewProps {
  library: IconLibrary;
  onBack: () => void;
}

const LARGE_LIBRARY_THRESHOLD = 300;
const PAGE_SIZE = 120;
const ICON_BOX = 48;
const ICON_SIZE = 26;
const STICKY_BG = "var(--figma-color-bg)";

export const LibraryDetailView: React.FC<LibraryDetailViewProps> = ({ library, onBack }) => {
  const [styleIndex, setStyleIndex] = useState(0);
  const [index, setIndex] = useState<PrefixIndex | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [nameStyle, setNameStyle] = useState("All");
  const [sortOrder, setSortOrder] = useState<"az" | "za">("az");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [phase, setPhase] = useState<"fetching" | "inserting" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const style = library.styles[styleIndex];

  useEffect(() => {
    setIndexLoading(true);
    setError(null);
    setQuery("");
    setCategory("All");
    setNameStyle("All");
    setVisibleCount(PAGE_SIZE);
    getPrefixIndex(style.prefix)
      .then(setIndex)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load icons"))
      .finally(() => setIndexLoading(false));
  }, [style.prefix]);

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

  // Only relevant for libraries with a single Iconify-level style — see
  // detectNameStyles for why (real style siblings already show as tabs).
  const nameStyles = useMemo(
    () => (index && library.styles.length === 1 ? detectNameStyles(index.names) : null),
    [index, library.styles.length]
  );

  const filteredNames = useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    let names = index.names;
    if (q) names = names.filter((n) => n.includes(q));
    if (category !== "All") names = names.filter((n) => index.categoryByName.get(n) === category);
    if (nameStyles && nameStyle !== "All") {
      names = names.filter((n) => nameStyles.styleByName.get(n) === nameStyle);
    }
    names = [...names].sort((a, b) => (sortOrder === "az" ? a.localeCompare(b) : b.localeCompare(a)));
    return names;
  }, [index, query, category, nameStyles, nameStyle, sortOrder]);

  useEffect(() => setVisibleCount(PAGE_SIZE), [query, category, nameStyle, sortOrder, style.prefix]);

  const visibleNames = filteredNames.slice(0, visibleCount);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, filteredNames.length));
    }
  };

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
      const names = index?.names ?? (await getPrefixIndex(style.prefix)).names;
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
                </Text>
              </Flex>

              {library.styles.length > 1 && (
                <SegmentedControl.Root
                  value={style.prefix}
                  onValueChange={(value: string) => {
                    if (!value) return;
                    const i = library.styles.findIndex((s) => s.prefix === value);
                    if (i >= 0) setStyleIndex(i);
                  }}
                  fullWidth
                >
                  {library.styles.map((s) => (
                    <SegmentedControl.Item key={s.prefix} value={s.prefix}>
                      <SegmentedControl.Text>{s.label}</SegmentedControl.Text>
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl.Root>
              )}

              <Flex gap="2">
                <Input
                  placeholder={`Search within ${style.label}…`}
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
                    }}
                  >
                    <option value="All">All categories</option>
                    {index.categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
                {nameStyles && (
                  <select
                    value={nameStyle}
                    onChange={(e) => setNameStyle(e.target.value)}
                    title="This library keeps its variants (outline/filled/round/etc.) as part of the icon name rather than as separate styles, so this filter is detected from the names themselves."
                    style={{
                      background: "var(--figma-color-bg-secondary)",
                      border: "1px solid var(--figma-color-border)",
                      borderRadius: 6,
                      color: "var(--figma-color-text)",
                      padding: "0 0.4rem",
                    }}
                  >
                    <option value="All">All icon styles</option>
                    {nameStyles.styles.map((s) => (
                      <option key={s} value={s}>{s}</option>
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
                const icon = `${style.prefix}:${name}`;
                return (
                  <button
                    key={icon}
                    onClick={() => setSelected(icon)}
                    title={icon}
                    className="icontopia-icon-cell"
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
            <Button variant="primary" size="medium" fullWidth onClick={importStyle} disabled={importing}>
              {importing
                ? phase === "fetching"
                  ? `Fetching icons… ${progress.done}/${progress.total}`
                  : `Inserting icons… ${progress.done}/${progress.total}`
                : `Import all ${style.total.toLocaleString()} icons (${style.label})`}
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
