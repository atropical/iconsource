import React from "react";
import { Checkbox, Flex } from "figma-kit";
import { IconImportOptions } from "../types.d";
import { IconColorPicker } from "./IconColorPicker";

interface ImportOptionsControlsProps {
  value: IconImportOptions;
  onChange: (value: IconImportOptions) => void;
  /** Multi-colour set: flattening or recolouring would merge every colour into one, so both are turned off. */
  palette?: boolean;
  disabled?: boolean;
  idPrefix: string;
}

export const ImportOptionsControls: React.FC<ImportOptionsControlsProps> = ({ value, onChange, palette, disabled, idPrefix }) => (
  <Flex gap="4" align="center" wrap="wrap">
    <Checkbox.Root>
      <Checkbox.Input
        id={`${idPrefix}-outline`}
        checked={!!value.outline}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, outline: e.target.checked })}
      />
      <Checkbox.Label htmlFor={`${idPrefix}-outline`}>Outline strokes</Checkbox.Label>
    </Checkbox.Root>
    <Checkbox.Root title={palette ? "Not available for multi-colour icons" : undefined}>
      <Checkbox.Input
        id={`${idPrefix}-flatten`}
        checked={!!value.flatten && !palette}
        disabled={disabled || palette}
        onChange={(e) => onChange({ ...value, flatten: e.target.checked })}
      />
      <Checkbox.Label htmlFor={`${idPrefix}-flatten`}>Flatten layers</Checkbox.Label>
    </Checkbox.Root>
    <IconColorPicker
      value={palette ? undefined : value.color}
      onChange={(color) => onChange({ ...value, color })}
      disabled={disabled || palette}
    />
  </Flex>
);
