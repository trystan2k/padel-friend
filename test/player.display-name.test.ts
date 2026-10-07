import { describe, expect, it } from 'vitest';
import {
  EDGE_WHITESPACE,
  hasEdgeWhitespace,
  stripEdgeWhitespace
} from '../src/lib/edge-whitespace';

describe('display-name edge-whitespace class', () => {
  it("is exactly the ASCII class of the SQL btrim(display_name, E' \\t\\n\\r\\f\\v') rule", () => {
    // RegExp.source keeps the backslash escapes, so this pins the shared class character
    // by character: widening it to the Unicode whitespace class can never happen silently.
    expect(EDGE_WHITESPACE.source).toBe('[ \\t\\n\\r\\f\\v]');
    expect(EDGE_WHITESPACE.flags).toBe('');
  });
});

describe('stripEdgeWhitespace', () => {
  it('strips ASCII edge whitespace', () => {
    expect(stripEdgeWhitespace('  Ana  ')).toBe('Ana');
  });

  it('strips every character of the SQL btrim ASCII class from both edges', () => {
    for (const edge of [' ', '\t', '\n', '\r', '\f', '\v']) {
      expect(stripEdgeWhitespace(`${edge}Ana${edge}`)).toBe('Ana');
    }
    expect(stripEdgeWhitespace('\t\n\r\f\vAna\t\n\r\f\v')).toBe('Ana');
  });

  it('preserves Unicode whitespace (NBSP) at the edges exactly as typed', () => {
    expect(stripEdgeWhitespace('\u00A0Ana\u00A0')).toBe('\u00A0Ana\u00A0');
  });

  it('strips only the ASCII edges of a mixed-padded value, keeping the NBSP edges', () => {
    expect(stripEdgeWhitespace(' \u00A0Ana\u00A0 ')).toBe('\u00A0Ana\u00A0');
  });

  it('leaves internal whitespace of both classes untouched', () => {
    expect(stripEdgeWhitespace('Ana\tLee\u00A0Lee')).toBe('Ana\tLee\u00A0Lee');
  });

  it('reduces empty and ASCII-whitespace-only values to an empty string', () => {
    expect(stripEdgeWhitespace('')).toBe('');
    expect(stripEdgeWhitespace('   ')).toBe('');
    expect(stripEdgeWhitespace('\t\n\r\f\v')).toBe('');
  });

  it('keeps an NBSP-only value intact: it is NOT empty under the ASCII-only rule', () => {
    expect(stripEdgeWhitespace('\u00A0\u00A0')).toBe('\u00A0\u00A0');
  });
});

describe('hasEdgeWhitespace', () => {
  it('is true for every value edged by the SQL btrim ASCII class', () => {
    for (const name of [
      ' Ana',
      'Ana ',
      '\tAna\t',
      '\nAna',
      'Ana\r',
      '\f\f',
      '\v',
      '   ',
      '\t\n\r\f\v',
      ' \u00A0Ana\u00A0 '
    ]) {
      expect(hasEdgeWhitespace(name)).toBe(true);
    }
  });

  it('is false for clean values, NBSP-edged values and empty values', () => {
    for (const name of ['Ana', 'Ana Lee', 'Ana\tLee', '\u00A0Ana\u00A0', '\u00A0\u00A0', '']) {
      expect(hasEdgeWhitespace(name)).toBe(false);
    }
  });
});
