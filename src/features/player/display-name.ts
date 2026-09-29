export const DISPLAY_NAME_EDGE_WHITESPACE = /[ \t\n\r\f\v]/;

const DISPLAY_NAME_EDGE_WHITESPACE_PATTERN = new RegExp(
  `^${DISPLAY_NAME_EDGE_WHITESPACE.source}+|${DISPLAY_NAME_EDGE_WHITESPACE.source}+$`,
  'g'
);

export function stripDisplayNameEdgeWhitespace(value: string): string {
  return value.replace(DISPLAY_NAME_EDGE_WHITESPACE_PATTERN, '');
}

export function hasDisplayNameEdgeWhitespace(value: string): boolean {
  return stripDisplayNameEdgeWhitespace(value) !== value;
}
