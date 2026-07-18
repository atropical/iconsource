import React from "react";
import { Flex } from "figma-kit";

/** Placeholder shaped like a real library card in LibrariesView, shown while /collections is still loading. */
export const LibraryCardSkeleton: React.FC = () => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 6,
      padding: "0.6rem 0.75rem",
      border: "1px solid var(--figma-color-border)",
      borderRadius: 6,
    }}
  >
    <Flex justify="between" align="center">
      <div className="iconsource-skeleton" style={{ width: 130, height: 14 }} />
      <div className="iconsource-skeleton" style={{ width: 90, height: 12 }} />
    </Flex>
    <Flex gap="2" align="center">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="iconsource-skeleton" style={{ width: 26, height: 26, borderRadius: 6 }} />
      ))}
    </Flex>
    <div className="iconsource-skeleton" style={{ width: 170, height: 12 }} />
  </div>
);
