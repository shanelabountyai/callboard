import type { CSSProperties } from 'react';

/** The eight AoR hues (design brief): the planner picks from swatches, never a free colour. Only the stripe and row header use them. */
export const AOR_COLORS = [
  ['indigo', '#4f46e5'], ['blue', '#2563eb'], ['green', '#059669'], ['orange', '#ea580c'],
  ['pink', '#db2777'], ['teal', '#0d9488'], ['purple', '#9333ea'], ['brown', '#92400e'],
] as const;
export const AOR_HEX = AOR_COLORS.map(([, hex]) => hex);

/** Sets the `--aor` custom property the `.stripe` and `.swatches` classes read. */
export const aor = (color?: string | null): CSSProperties => ({ ['--aor' as string]: color ?? undefined }) as CSSProperties;
