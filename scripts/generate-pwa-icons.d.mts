export const GLYPH: { start: number; end: number; stroke: number };
export const MASKABLE_SAFE_RADIUS: number;
export function glyphReach(): number;
export function iconColors(css: string): { background: string; glyph: string };
export function iconSvg(
  colors: { background: string; glyph: string },
  options: { rounded: boolean }
): string;
export function iconFiles(colors: { background: string; glyph: string }): Array<{
  file: string;
  svg: string;
  size?: number;
}>;
