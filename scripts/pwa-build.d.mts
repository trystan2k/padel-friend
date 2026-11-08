export const OFFLINE_LOCALES: string[];
export const PRECACHE_GLOB_PATTERNS: string[];
export function isAllowedPrecacheUrl(url: string): boolean;
export type TokenSet = { light: Map<string, string>; dark: Map<string, string> };
export function parseTokens(css: string): TokenSet;
export function resolveTokens(tokens: TokenSet, theme: 'light' | 'dark'): Record<string, string>;
export function renderOfflineDocument(options: {
  tokens: TokenSet;
  locales: Record<string, { title: string; pwa: { offline: Record<string, string> } }>;
}): string;
export function injectPrecacheManifest(options: {
  globDirectory: string;
  swSrc: string;
  swDest: string;
}): Promise<{ count: number; warnings: string[] }>;
