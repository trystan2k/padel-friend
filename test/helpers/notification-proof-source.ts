import { readFileSync } from 'node:fs';

const JOB_ASSERTION = /expectNotificationOutcome|expectNotificationPushJobs|notification_push_jobs/;
const RECIPIENT_ASSERTION = /expectNotificationOutcome|recipient/;
const MAX_HELPER_DEPTH = 2;

/** Slice from the opening bracket at `start` to its balanced close, skipping strings and comments. */
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
    else if (char === '/' && source[index + 1] === '/')
      index = Math.max(source.indexOf('\n', index), index);
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
  const brace = rest.indexOf('{');
  if (!arrow || (brace >= 0 && brace < arrow.index + arrow[0].length + 1))
    return brace < 0 ? '' : balanced(source, declaration.index + brace);
  const body = rest.slice(arrow.index + arrow[0].length);
  const end = body.search(/\n\s*(?:const|let|function|it|describe)\b/);
  return end < 0 ? body : body.slice(0, end);
}

function withHelpers(source: string, body: string, depth: number): string {
  if (depth === 0) return body;
  const names = new Set([...body.matchAll(/\b([A-Za-z_]\w*)\(/g)].map((match) => match[1]!));
  return [
    body,
    ...[...names].map((name) => withHelpers(source, helperBody(source, name), depth - 1))
  ].join('\n');
}

/** Locate a named test in its source file and report whether it (or its local helpers) asserts recipients and Push jobs. */
export function proofSourceAssertions(path: string, testName: string) {
  const source = readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
  const at = source.indexOf(testName);
  if (at < 0) return { found: false, recipients: false, jobs: false };
  const body = withHelpers(source, balanced(source, source.lastIndexOf('(', at)), MAX_HELPER_DEPTH);
  return {
    found: true,
    recipients: RECIPIENT_ASSERTION.test(body),
    jobs: JOB_ASSERTION.test(body)
  };
}
