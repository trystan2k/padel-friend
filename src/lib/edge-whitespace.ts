export const EDGE_WHITESPACE = /[ \t\n\r\f\v]/;

const EDGE_WHITESPACE_PATTERN = new RegExp(
  `^${EDGE_WHITESPACE.source}+|${EDGE_WHITESPACE.source}+$`,
  'g'
);

export function stripEdgeWhitespace(value: string): string {
  return value.replace(EDGE_WHITESPACE_PATTERN, '');
}

export function hasEdgeWhitespace(value: string): boolean {
  return stripEdgeWhitespace(value) !== value;
}
