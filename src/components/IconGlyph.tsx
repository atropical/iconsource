import React from "react";

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
 */
export const IconGlyph: React.FC<IconGlyphProps> = ({ icon, size = 24, color, style }) => {
  const url = `https://api.iconify.design/${icon.replace(":", "/")}.svg`;

  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        backgroundColor: color ?? "currentColor",
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
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
