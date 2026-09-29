export function playerInitials(name: string): string {
  // Locale-insensitive casing keeps SSR output deterministic for hydration.
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
