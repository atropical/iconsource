import React, { useEffect, useMemo, useState } from "react";
import { Flex, Input, Popover, Text } from "figma-kit";
import { IconColor, MessageTypes, PluginMessage } from "../types.d";

interface IconColorPickerProps {
  value?: IconColor;
  onChange: (value: IconColor | undefined) => void;
  disabled?: boolean;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function labelFor(color?: IconColor): string {
  if (!color) return "Original";
  if (color.kind === "hex") return color.hex.toUpperCase();
  return color.name;
}

function sameColor(a?: IconColor, b?: IconColor): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "hex" && b.kind === "hex") return a.hex.toLowerCase() === b.hex.toLowerCase();
  if (a.kind === "variable" && b.kind === "variable") return (a.key ?? a.id) === (b.key ?? b.id);
  if (a.kind === "style" && b.kind === "style") return a.id === b.id;
  return false;
}

const Swatch: React.FC<{ color?: IconColor }> = ({ color }) => {
  const hex = color?.kind === "hex" ? color.hex : color?.hex;
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        borderRadius: color?.kind === "variable" ? 4 : 7,
        border: "1px solid var(--figma-color-border)",
        background: hex ?? (color ? "repeating-linear-gradient(45deg, var(--figma-color-bg-tertiary) 0 3px, transparent 3px 6px)" : "transparent"),
      }}
    />
  );
};

/**
 * Colour applied to imported icons: none (keep the SVG's own colour), a hex
 * value, or a colour variable / paint style from the file or its enabled
 * libraries. Sources are fetched from the main thread when the picker opens.
 */
export const IconColorPicker: React.FC<IconColorPickerProps> = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<IconColor[] | null>(null);
  const [query, setQuery] = useState("");
  const [hexDraft, setHexDraft] = useState(value?.kind === "hex" ? value.hex : "");

  useEffect(() => {
    if (!open) return;
    const handler = ({ data: { pluginMessage } }: { data: { pluginMessage: PluginMessage } }) => {
      if (pluginMessage.type === MessageTypes.COLOR_SOURCES_RESULT) setSources(pluginMessage.colorSources ?? []);
    };
    window.addEventListener("message", handler);
    parent.postMessage({ pluginMessage: { type: MessageTypes.COLOR_SOURCES_REQUEST } as PluginMessage }, "*");
    return () => window.removeEventListener("message", handler);
  }, [open]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map<string, IconColor[]>();
    for (const s of sources ?? []) {
      const group = s.kind === "variable" ? s.group : "Colour styles";
      if (q && !`${group} ${labelFor(s)}`.toLowerCase().includes(q)) continue;
      const list = groups.get(group) ?? [];
      list.push(s);
      groups.set(group, list);
    }
    return [...groups.entries()];
  }, [sources, query]);

  const pick = (color: IconColor | undefined) => {
    onChange(color);
    setOpen(false);
  };

  const commitHex = () => {
    if (!HEX_RE.test(hexDraft)) return;
    pick({ kind: "hex", hex: hexDraft.startsWith("#") ? hexDraft : `#${hexDraft}` });
  };

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "4px 6px",
    border: 0,
    borderRadius: 4,
    background: active ? "var(--figma-color-bg-selected)" : "transparent",
    color: "var(--figma-color-text)",
    textAlign: "left",
    cursor: "pointer",
    // Native buttons don't inherit the page font, so set figma-kit's tokens explicitly.
    fontFamily: "var(--font-family-default)",
    fontSize: "var(--font-size-default)",
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* figma-kit's Trigger slots onto its child, so it needs exactly one element. */}
      <Popover.Trigger>
        <button
          type="button"
          disabled={disabled}
          style={{ ...rowStyle(false), width: "auto", border: "1px solid var(--figma-color-border)", padding: "3px 8px", opacity: disabled ? 0.5 : 1 }}
        >
          <Swatch color={value} />
          <span>Colour: {labelFor(value)}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
      {/* width/maxHeight are props here: figma-kit overwrites those keys in `style`. */}
      <Popover.Content side="top" align="start" width={280} maxHeight={360} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8, zIndex: 10, fontFamily: "var(--font-family-default)", fontSize: "var(--font-size-default)" }}>
        <button type="button" style={rowStyle(!value)} onClick={() => pick(undefined)}>
          <Swatch />
          <span>Original colours</span>
        </button>

        <Flex gap="2" align="center">
          <Input
            placeholder="#000000"
            value={hexDraft}
            onChange={(e) => setHexDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitHex()}
            onBlur={commitHex}
            style={{ flex: 1 }}
          />
        </Flex>

        <Input placeholder="Search variables and styles" value={query} onChange={(e) => setQuery(e.target.value)} />

        <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
          {sources === null && <Text style={{ color: "var(--figma-color-text-secondary)" }}>Loading…</Text>}
          {sources !== null && grouped.length === 0 && (
            <Text style={{ color: "var(--figma-color-text-secondary)" }}>
              {query ? "No matches" : "No colour variables or styles in this file or its enabled libraries"}
            </Text>
          )}
          {grouped.map(([group, items]) => (
            <div key={group} style={{ marginBottom: 6 }}>
              <Text style={{ color: "var(--figma-color-text-secondary)", padding: "4px 6px", display: "block" }}>{group}</Text>
              {items.map((item) => (
                <button
                  key={item.kind === "variable" ? item.key ?? item.id : item.kind === "style" ? item.id : item.hex}
                  type="button"
                  style={rowStyle(sameColor(item, value))}
                  onClick={() => pick(item)}
                >
                  <Swatch color={item} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelFor(item)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
