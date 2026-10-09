import { readFileSync } from 'node:fs';
import { parseAst } from 'vite';
import { describe, expect, it } from 'vitest';
import { EDGE_WHITESPACE } from '../src/lib/edge-whitespace';

const VALIDATORS_SOURCE = readFileSync(
  new URL('../src/features/player/player.validators.ts', import.meta.url),
  'utf8'
);
const ONBOARDING_SOURCE = readFileSync(
  new URL('../src/features/player/PlayerOnboarding.tsx', import.meta.url),
  'utf8'
);
const PROFILE_SOURCE = readFileSync(
  new URL('../src/features/player/PlayerProfile.tsx', import.meta.url),
  'utf8'
);
const MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260928000000_player_profiles_and_ratings.sql', import.meta.url),
  'utf8'
);
// Read-only reference: this contract does not prove the payload wiring itself (see the
// "references the shared-strip helper on the display name" test below); it only pins that
// the behavioral e2e guards in e2e/onboarding.spec.ts stay in place.
const E2E_ONBOARDING_SOURCE = readFileSync(
  new URL('../e2e/onboarding.spec.ts', import.meta.url),
  'utf8'
);

const DISPLAY_NAME_SOURCES = {
  'player.validators.ts': VALIDATORS_SOURCE,
  'PlayerOnboarding.tsx': ONBOARDING_SOURCE,
  'PlayerProfile.tsx': PROFILE_SOURCE
} as const;

type SourceLanguage = 'ts' | 'tsx';

const SOURCE_LANGUAGE: Record<keyof typeof DISPLAY_NAME_SOURCES, SourceLanguage> = {
  'player.validators.ts': 'ts',
  'PlayerOnboarding.tsx': 'tsx',
  'PlayerProfile.tsx': 'tsx'
};

// String.prototype.trim() strips the whole Unicode whitespace class, so applying it to a
// display name silently drops NBSP edges and drifts away from the server's ASCII-only
// btrim rule. Bio is exempt (no server-side whitespace rule) and the validator's avatar_url
// and bio paths trim by design.
const ALLOWED_TRIM_RECEIVERS: Record<keyof typeof DISPLAY_NAME_SOURCES, readonly string[]> = {
  'player.validators.ts': ['value', 'avatar_url'],
  'PlayerOnboarding.tsx': ['bio'],
  'PlayerProfile.tsx': ['bio']
};

// The trim scan is syntax-aware: each source is parsed into an AST and every member access
// of `trim` — dot (`x.trim()`), optional (`x?.trim()`), non-null (`x!.trim()`) or computed
// (`x['trim']()`) — is resolved to its full receiver expression before checking. A parsed
// tree has no formatting, so spacing variants (`name.trim ()`) and wrapper rewrites
// (`String(name).trim()`, `(name).trim()`, `(name as string).trim()`) cannot dodge the
// per-file allowlist the way a string/regex scan could.
function parseToAst(source: string, lang: SourceLanguage): unknown {
  return parseAst(source, { lang });
}

type SyntaxNode = {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
};

function isSyntaxNode(value: unknown): value is SyntaxNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    'start' in value &&
    typeof value.start === 'number' &&
    'end' in value &&
    typeof value.end === 'number'
  );
}

function walkSyntaxNodes(root: unknown, visit: (node: SyntaxNode) => void): void {
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!isSyntaxNode(value)) return;
    visit(value);
    for (const child of Object.values(value)) walk(child);
  };
  walk(root);
}

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === '\n') line += 1;
  }
  return line;
}

// The allowlist speaks in receiver identifiers (`value`, `avatar_url`, `bio`): for a receiver
// expression that is the last identifier chunk, so `input.avatar_url` maps to `avatar_url`
// and `String(bio)` still maps to `bio`. Wrapper forms like `(name as string)` yield junk
// tails (`string`) that never match the allowlist and are therefore flagged.
function receiverTailIdentifier(receiver: string): string {
  const chunks = receiver.match(/[A-Za-z_$][\w$]*/g);
  return chunks ? (chunks[chunks.length - 1] ?? receiver) : receiver;
}

// `name`, `normalizedName`, `input.display_name` and `displayNameText(...)` all reference
// the display name: identifier chunks are split along camelCase and snake_case boundaries
// and the `name` word is looked for. Every wrapper rewrite keeps the identifier inside the
// receiver expression, which is what makes the wrapper forms detectable at all.
function referencesDisplayName(expression: string): boolean {
  const chunks = expression.match(/[A-Za-z_$][\w$]*/g) ?? [];
  return chunks.some((chunk) =>
    chunk
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[\s_$]+/)
      .some((word) => word.toLowerCase() === 'name')
  );
}

// A computed key is statically readable when it is a string literal (`name['trim']`) or a
// template literal with no expressions (``name[`trim`]`` is exactly `name['trim']()` spelled
// with backticks). Dynamic templates (``name[`tr${'im'}`]()``) and every other expression
// cannot be resolved here and come back as 'unknown'; the walker treats an unresolvable key
// on a display-name receiver as a violation instead of silently ignoring it (fail closed).
function cookedTextOf(quasi: SyntaxNode): string | null {
  const value = quasi.value;
  if (typeof value !== 'object' || value === null || !('cooked' in value)) return null;
  const cooked = value.cooked;
  return typeof cooked === 'string' ? cooked : null;
}

type ComputedKeyResolution = 'trim' | 'other' | 'unknown';

function resolveComputedKey(property: SyntaxNode): ComputedKeyResolution {
  if (property.type === 'Literal')
    return typeof property.value === 'string' && property.value === 'trim' ? 'trim' : 'other';
  if (property.type !== 'TemplateLiteral') return 'unknown';
  const expressions = property.expressions;
  if (Array.isArray(expressions) && expressions.length > 0) return 'unknown';
  const quasis = property.quasis;
  const quasi = Array.isArray(quasis) ? quasis[0] : undefined;
  if (!quasi || !isSyntaxNode(quasi)) return 'unknown';
  const cooked = cookedTextOf(quasi);
  if (cooked === null) return 'unknown';
  return cooked === 'trim' ? 'trim' : 'other';
}

type TrimCall = { receiver: string; tail: string; start: number; line: number };

function trimCalls(
  source: string,
  lang: SourceLanguage,
  gateSpan?: { start: number; end: number } | null
): TrimCall[] {
  const calls: TrimCall[] = [];
  walkSyntaxNodes(parseToAst(source, lang), (node) => {
    if (node.type !== 'MemberExpression') return;
    const property = node.property;
    if (!isSyntaxNode(property)) return;
    const receiverNode = node.object;
    if (!isSyntaxNode(receiverNode)) return;
    const receiver = source.slice(receiverNode.start, receiverNode.end);
    if (node.computed === true) {
      const key = resolveComputedKey(property);
      // Statically readable and not `trim` (`name['length']`, `parts[0]`): no violation.
      if (key === 'other') return;
      const insideGate =
        gateSpan !== null &&
        gateSpan !== undefined &&
        node.start >= gateSpan.start &&
        node.start <= gateSpan.end;
      // Unresolvable key: it could be `trim` at runtime (`const key = 'trim'`). On a
      // display-name receiver it is kept wherever it appears; inside the displayNameText
      // gate it is kept regardless of receiver, so the receiver allowlist can never
      // discard the access before the gate scope gets to reject it.
      if (key === 'unknown' && !referencesDisplayName(receiver) && !insideGate) return;
    } else if (property.type !== 'Identifier' || property.name !== 'trim') {
      return;
    }
    calls.push({
      receiver,
      tail: receiverTailIdentifier(receiver),
      start: node.start,
      line: lineNumberAt(source, node.start)
    });
  });
  return calls;
}

// The validator's `displayNameText` gate receives the display name as its `value`
// parameter, so the per-file allowlist entry for `value` (needed by the bio helper) must
// not leak into that function: inside its body, no trim access is allowed on any receiver.
// Returns the source span of the declaration, or null when the file declares none.
function displayNameTextSpan(
  source: string,
  lang: SourceLanguage
): { start: number; end: number } | null {
  let span: { start: number; end: number } | null = null;
  walkSyntaxNodes(parseToAst(source, lang), (node) => {
    if (span) return;
    if (node.type !== 'FunctionDeclaration') return;
    const id = node.id;
    if (!isSyntaxNode(id) || id.type !== 'Identifier' || id.name !== 'displayNameText') return;
    span = { start: node.start, end: node.end };
  });
  return span;
}

// A trim member access violates the contract when its receiver expression references the
// display name in any wrapper form, or when its receiver identifier is outside the per-file
// allowlist. Receiver-level matching subsumes line-level scanning: a wrapper cannot move the
// display-name identifier out of the expression, and any other unexpected receiver is
// rejected by the allowlist wholesale.
function displayTrimViolations(
  source: string,
  lang: SourceLanguage,
  allowed: readonly string[]
): string[] {
  const span = displayNameTextSpan(source, lang);
  return trimCalls(source, lang, span)
    .filter(({ receiver, tail, start }) => {
      // Inside the displayNameText gate the `value` parameter IS the display name, so the
      // per-file allowlist (which admits `value` for the bio helper) does not apply there:
      // any trim access in that scope is a violation, whatever the receiver.
      if (span !== null && start >= span.start && start <= span.end) return true;
      return referencesDisplayName(receiver) || !allowed.includes(tail);
    })
    .map(({ receiver, tail, line }) => `${receiver} (tail: ${tail}, line: ${line})`);
}

describe('display-name ASCII edge-whitespace rule single-source contract', () => {
  it('is imported from the shared module in every display-name-handling layer', () => {
    expect(VALIDATORS_SOURCE).toContain("from '../../lib/edge-whitespace'");
    expect(ONBOARDING_SOURCE).toContain("from '../../lib/edge-whitespace'");
    expect(PROFILE_SOURCE).toContain("from '../../lib/edge-whitespace'");
  });

  it('imports both helpers in the validator and the strip helper in both forms', () => {
    expect(VALIDATORS_SOURCE).toContain(
      "import { hasEdgeWhitespace, stripEdgeWhitespace } from '../../lib/edge-whitespace';"
    );
    expect(ONBOARDING_SOURCE).toContain(
      "import { stripEdgeWhitespace } from '../../lib/edge-whitespace';"
    );
    expect(PROFILE_SOURCE).toContain(
      "import { stripEdgeWhitespace } from '../../lib/edge-whitespace';"
    );
  });

  it('gates display names through the shared helpers in the validator, with no local trim', () => {
    const displayNameTextBody = /function displayNameText[\s\S]*?\n\}/.exec(VALIDATORS_SOURCE)?.[0];
    expect(displayNameTextBody, 'displayNameText must stay in player.validators.ts').toBeTruthy();
    expect(displayNameTextBody).toContain('hasEdgeWhitespace(value)');
    expect(displayNameTextBody).toContain('stripEdgeWhitespace(value)');
    expect(
      displayNameTextBody,
      'the display-name gate must never apply a Unicode trim'
    ).not.toContain('.trim(');
  });

  it('references the shared-strip helper on the display name in both forms and pins the e2e payload-wiring guards', () => {
    // Static presence only: these lines prove the helper is applied to `name`, NOT that the
    // submitted payload is the helper's output, nor that NBSP survives the round trip. That
    // payload wiring is covered behaviorally by the e2e suite in e2e/onboarding.spec.ts
    // (kept intact): an NBSP-edged save is persisted verbatim ("an NBSP-edged display name
    // is saved verbatim and persists with its NBSPs") and the profile edit form preserves
    // NBSP edges while trimming only ASCII edges ("the profile edit form preserves NBSP
    // edges and trims only ASCII edges on save"). The assertions below fail if those e2e
    // guards are removed or renamed, so this contract never overclaims what it proves.
    expect(ONBOARDING_SOURCE).toContain('stripEdgeWhitespace(name)');
    expect(PROFILE_SOURCE).toContain('stripEdgeWhitespace(name)');
    expect(E2E_ONBOARDING_SOURCE).toContain(
      'an NBSP-edged display name is saved verbatim and persists with its NBSPs'
    );
    expect(E2E_ONBOARDING_SOURCE).toContain(
      'the profile edit form preserves NBSP edges and trims only ASCII edges on save'
    );
  });

  it('never applies String.prototype.trim() to a display name in any wrapper form (bio and avatar_url are the only exempt receivers)', () => {
    for (const name of [
      'player.validators.ts',
      'PlayerOnboarding.tsx',
      'PlayerProfile.tsx'
    ] as const) {
      const source = DISPLAY_NAME_SOURCES[name];
      const allowed = [...ALLOWED_TRIM_RECEIVERS[name]].sort();
      const violations = [
        ...new Set(displayTrimViolations(source, SOURCE_LANGUAGE[name], allowed))
      ].sort();
      expect(
        violations,
        `${name} trims ${violations.join(' | ')} — display names must go through the shared ASCII rule`
      ).toEqual([]);
      const tails = [
        ...new Set(trimCalls(source, SOURCE_LANGUAGE[name]).map(({ tail }) => tail))
      ].sort();
      expect(
        tails,
        `${name} no longer uses an allowed trim receiver (${allowed.join(', ')}) — update this contract deliberately`
      ).toEqual(allowed);
    }
  });

  it('detects wrapper-form trim evasions on the display-name identifier (fixture-driven)', () => {
    // Exercises the exact detection pipeline used for the real files above against the
    // known rewrites that used to slip past a plain string/regex scan, including the
    // spacing variant `name.trim ()`, the computed `name['trim']()` form and the
    // static-template `name[`trim`]() form. Dynamic templates (`name[`tr${'im'}`]()`)
    // cannot be statically resolved and fail closed on a display-name receiver. If any
    // form stops being detected, this test fails — the AST check cannot silently regress.
    const evasionForms = [
      'name.trim()',
      'name.trim ()',
      'name?.trim()',
      'name!.trim()',
      "name['trim']()",
      'name[`trim`]()',
      "name[`tr${'im'}`]()",
      'String(name).trim()',
      '(name as string).trim()',
      '(((name))).trim()',
      'input.display_name.trim()'
    ];
    for (const form of evasionForms) {
      const fixture = `submit(${form});`;
      expect(
        displayTrimViolations(fixture, 'ts', ['bio']),
        `evasion slipped through: ${form}`
      ).toHaveLength(1);
    }
    // Binding the method without calling it is an evasion too: the member access itself
    // is the violation, so the display name cannot be trimmed indirectly either.
    expect(displayTrimViolations('const t = name.trim;', 'ts', ['bio'])).toHaveLength(1);
    // A display-name trim spread across lines is still one violation.
    expect(
      displayTrimViolations('const x = (\n  name as string\n).trim();', 'ts', ['bio'])
    ).toHaveLength(1);
    // Wrapper rewrites also defeat allowlist tail-matching on other identifiers.
    expect(
      displayTrimViolations('const normalized = (value as string).trim();', 'ts', ['value'])
    ).not.toEqual([]);
    // The exempt receivers stay allowed in their plain forms under each file's allowlist.
    expect(displayTrimViolations('submit(bio.trim());', 'ts', ['bio'])).toEqual([]);
    expect(
      displayTrimViolations('submit(avatar_url.trim());', 'ts', ['value', 'avatar_url'])
    ).toEqual([]);
    expect(displayTrimViolations('submit(value.trim());', 'ts', ['value', 'avatar_url'])).toEqual(
      []
    );
    // A statically readable computed key that is not `trim` is no violation: the template
    // and literal forms must resolve exactly instead of flagging every bracketed access.
    expect(displayTrimViolations('submit(name[`trims`]());', 'ts', ['bio'])).toEqual([]);
    expect(displayTrimViolations('submit(parts[0]());', 'ts', ['bio'])).toEqual([]);
  });

  it('scopes the per-file allowlist by function: nothing may trim inside displayNameText', () => {
    // `value` is allowlisted in player.validators.ts for the bio helper (trimmedText), but
    // inside displayNameText `value` IS the display name. The allowlist must not leak into
    // that scope — the bracket form (`value['trim']()`) must be flagged even though the
    // receiver identifier itself is allowlisted for the file.
    const bracketFixture = [
      'function displayNameText(value: string): string {',
      "  return value['trim']();",
      '}'
    ].join('\n');
    expect(displayTrimViolations(bracketFixture, 'ts', ['value', 'avatar_url'])).toHaveLength(1);
    // The dot form is equally banned inside the gate.
    const dotFixture = [
      'function displayNameText(value: string): string {',
      '  return value.trim();',
      '}'
    ].join('\n');
    expect(displayTrimViolations(dotFixture, 'ts', ['value'])).toHaveLength(1);
    // An unresolvable computed key (`const key = 'trim'`) is discarded by the receiver
    // heuristics everywhere else, but inside the gate it must survive to the span check:
    // `value` is allowlisted for the file, yet here it IS the display name.
    const indirectFixture = [
      'function displayNameText(value: string): string {',
      "  const key = 'trim';",
      '  return value[key]();',
      '}'
    ].join('\n');
    expect(displayTrimViolations(indirectFixture, 'ts', ['value', 'avatar_url'])).toHaveLength(1);
    // Outside the gate the discard heuristics still apply: an unresolvable computed key on
    // a non-display-name receiver stays ignored.
    expect(displayTrimViolations('submit(parts[key]());', 'ts', ['bio'])).toEqual([]);
    // Outside the gate the per-file allowlist still applies, so the bio helper stays legal.
    const bioFixture = [
      'function trimmedText(value: string): string {',
      '  return value.trim();',
      '}'
    ].join('\n');
    expect(displayTrimViolations(bioFixture, 'ts', ['value'])).toEqual([]);
  });

  it('keeps the shared class identical to the SQL btrim ASCII class in the migration', () => {
    // [ \t\n\r\f\v] minus its regex brackets is exactly the class spelled in the E'' literal.
    const asciiClass = EDGE_WHITESPACE.source.replace(/^\[/, '').replace(/\]$/, '');
    expect(MIGRATION).toContain(`btrim(display_name, E'${asciiClass}')`);
  });
});
