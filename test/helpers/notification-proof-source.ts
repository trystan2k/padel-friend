import { readFileSync } from 'node:fs';

/** Event-specific evidence a proof test must contain: the transition's command and notification kind. */
export type ProofEvidence = {
  /** notifications.kind of the transition (or of its positive counterpart when the row is an exclusion). */
  kind: string;
  /** The command, RPC or processor that performs the transition. */
  command: string;
  /** The row's contract is also an exclusion: unaffected recipients must be asserted silent. */
  silence?: true;
};

const JOB_HELPER = /expectNotificationPushJobs|notification_push_jobs/;
const MAX_HELPER_DEPTH = 2;

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Slice from the opening bracket at `start` to its balanced close, skipping strings. */
function balanced(source: string, start: number) {
  const open = source[start];
  const close = open === '(' ? ')' : '}';
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
}

function helperBody(source: string, name: string) {
  const declaration = new RegExp(`(?:function\\s+${name}\\b|(?:const|let)\\s+${name}\\s*=)`).exec(
    source
  );
  if (!declaration) return '';
  const rest = source.slice(declaration.index);
  const arrow = /=>\s*/.exec(rest);
  if (!declaration[0].startsWith('function') && arrow) {
    const bodyStart = declaration.index + arrow.index + arrow[0].length;
    if (source[bodyStart] === '{') return balanced(source, bodyStart);
    const body = source.slice(bodyStart);
    const end = body.search(/\n\s*(?:const|let|function|it|describe)\b/);
    return end < 0 ? body : body.slice(0, end);
  }
  const brace = rest.indexOf('{');
  return brace < 0 ? '' : balanced(source, declaration.index + brace);
}

function withHelpers(source: string, body: string, depth: number): string {
  if (depth === 0) return body;
  const names = new Set([...body.matchAll(/\b([A-Za-z_]\w*)\(/g)].map((match) => match[1]!));
  return [
    body,
    ...[...names].map((name) => withHelpers(source, helperBody(source, name), depth - 1))
  ].join('\n');
}

function callsOf(code: string, callee: string) {
  const calls: string[] = [];
  for (const match of code.matchAll(new RegExp(`${callee}\\(`, 'g')))
    calls.push(balanced(code, match.index + callee.length));
  return calls;
}

/**
 * Analyse a proof test against the transition it is bound to. Comments are ignored. The bound test (with its
 * local helpers) must invoke the event's command and assert the event's notification kind either in a
 * structured `expectNotificationOutcome({ kind, recipients })` call, or with the kind literal next to the
 * Push-job and recipient helpers. A mismatched or vacuous binding reports false for the missing piece.
 */
export function analyzeProofSource(source: string, testName: string, evidence: ProofEvidence) {
  const at = source.indexOf(testName);
  if (at < 0)
    return { found: false, command: false, kind: false, silence: false, ok: false as boolean };
  const code = stripComments(
    withHelpers(source, balanced(source, source.lastIndexOf('(', at)), MAX_HELPER_DEPTH)
  );
  const quoted = new RegExp(`['"\`]${evidence.kind}['"\`]`);
  // `channels(kind, target, recipients)` is the matrix suite's structured recipient + Push-job assertion.
  const structured =
    callsOf(code, 'expectNotificationOutcome').some(
      (call) => new RegExp(`kind:\\s*'${evidence.kind}'`).test(call) && /recipients:/.test(call)
    ) || callsOf(code, 'channels').some((call) => quoted.test(call) && /\[/.test(call));
  const kind = structured || (quoted.test(code) && JOB_HELPER.test(code) && /recipient/.test(code));
  const command = new RegExp(`\\b${evidence.command.replaceAll('.', '\\.')}\\b`).test(code);
  const silence = !evidence.silence || callsOf(code, 'expectNotificationSilence').length > 0;
  return { found: true, command, kind, silence, ok: command && kind && silence };
}

export function proofSourceAnalysis(path: string, testName: string, evidence: ProofEvidence) {
  return analyzeProofSource(
    readFileSync(new URL('../../' + path, import.meta.url), 'utf8'),
    testName,
    evidence
  );
}
