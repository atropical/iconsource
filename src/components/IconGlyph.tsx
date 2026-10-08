import React, { useEffect, useState } from "react";
import { getCachedIconSvg, loadIconSvg } from "../utils/iconSvgLoader";

interface IconGlyphProps {
  icon: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}

/**
 * Renders an Iconify icon as a CSS mask instead of an <img>. An <img>'s
 * fetched SVG has no CSS context, so `currentColor` inside it can't see the
 * card's actual text colour and falls back to black — poor contrast on dark
 * cards. Masking the icon shape onto a `background-color: currentColor` div
 * makes it inherit real ambient colour, and needs no extra network fetch
 * beyond the same .svg URL an <img> would have used.
 *
 * The SVG comes from loadIconSvg as a data: URI rather than a remote url():
 * CSS masks enforce CORS, and inside Figma's null-origin iframe a cached
 * response without the CORS header would block the icon for days.
 */
export const IconGlyph: React.FC<IconGlyphProps> = ({ icon, size = 24, color, style }) => {
  const [url, setUrl] = useState(() => getCachedIconSvg(icon) ?? null);

  useEffect(() => {
    setUrl(getCachedIconSvg(icon) ?? null);
    return loadIconSvg(icon, setUrl);
  }, [icon]);

  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        backgroundColor: color ?? "currentColor",
        WebkitMaskImage: url ? `url("${url}")` : undefined,
        maskImage: url ? `url("${url}")` : undefined,
        opacity: url ? undefined : 0,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        ...style,
      }}
    />
  );
};
