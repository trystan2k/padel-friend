import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Static guard (PAF-187, hardened PAF-182 F2): server functions and their server helpers must never
// rethrow a raw database/provider error. A PostgREST error serializes SQLSTATE, details and hint
// into the client response; every failure has to go through toClientError (or a fresh
// `new Error('<CODE>')`).
//
// Scope: every `src/**/*.functions.ts` and `src/**/*.server.ts` module (features, lib, i18n, ...).
// Route files and the worker entry `src/server.ts` are out of scope: they throw framework
// `redirect()`/`notFound()` objects by design and are not callable as server functions.
//
// Rules (each reports { file, line, rule }, never source text):
//   raw-throw                  `throw <anything but new … / toClientError(…)>`; allowed only with an
//                              inline `// guard-allow: raw-throw` (wrapper rethrowing an already-mapped error)
//   error-message-passthrough  `new Error(x.message|details|hint)`
//   dynamic-error              `new Error(<non-literal>)`. A string literal is safe by construction
//                              (a fixed constant cannot carry database detail). Dynamic arguments are
//                              allowed only in the sanctioned boundary (client-error.server.ts) or
//                              with an inline `// guard-allow: dynamic-error` on the same or the
//                              previous line, which makes every typed code-mapper site auditable.
//   raw-cause                  `{ cause … }` keeps the raw error on the thrown object. Allowed only
//                              with an inline `// guard-allow: cause` (server-side-only paths, e.g.
//                              cron work whose error never reaches a client).
//                              Cause MUTATION is covered too: `.cause =` and `['cause'] =` assignments
//                              (e.g. `reject(new Error('X').cause = raw)`) and `Object.assign(e, { cause })`
//                              are findings; `Object.assign(e, props)` with a non-literal `props` is not
//                              statically detectable (see limits).
//   promise-reject             `Promise.reject(…)` / `reject(<anything but new …Error(…) / toClientError(…)>)`;
//                              `reject(new Object(error))`, `reject(err)` and other indirections are findings
//
// Annotations: a `guard-allow` tag counts ONLY as a real line comment
// `// guard-allow: <tag> <non-empty reason>` on the flagged line or the line directly above it. Text
// inside strings, template literals, identifiers or block comments never counts, the tag must end at a
// token boundary (`cause` does not match `causes`), and a bare tag without a reason is ignored.
//
// LEXER LIMITS: no JS/TS parser is a direct dependency (acorn/espree/oxc-parser/@babel/parser are not
// resolvable from the repo root; TypeScript 7 exposes no stable JS API), so comments and regex
// literals are found by a hand-written lexer. A `/` starts a regex when the previous significant token
// is an operator, opener, `;`, `{`, `}` or a keyword such as `return`; after an identifier, number,
// `)` or `]` it is division (so `if (x) /re/.test(s)` is misread as division). A regex-looking `/`
// with no closing `/` on its line is treated as division. Regex bodies are blanked before scanning.
//
// KNOWN LIMIT (documented, not pretended): `Object.assign(e, props)` / spreads that carry a `cause`
// key from a non-literal object, and a helper that RETURNS a rejecting promise built from an
// arbitrary expression (`return client.rpc(…).then((r) => r.error ?? r)`, a stored promise, an
// awaited-elsewhere rejection) cannot be classified by a regex scan. Only the explicit
// `Promise.reject`/`reject(` forms and any `throw` inside the chain are caught. The remaining
// surface is covered by the behavioural unit tests of toClientError and each server function.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED = /\.(?:functions|server)\.ts$/;
const BOUNDARY_FILE = 'src/lib/client-error.server.ts';
// `throw` followed by anything other than `new …` or `toClientError(…)`; \s covers multiline forms.
const RAW_THROW = /\bthrow\s+(?!new\b|toClientError\s*\()/g;
// Wrapping the raw error as `cause` keeps it on the thrown object.
// Also covers non-leading `, cause:` properties, quoted keys, and `.cause =` / `['cause'] =` assignments
// (never legitimate in client-boundary code; `==`/`===` comparisons do not match).
const RAW_CAUSE =
  /\{\s*['"`]?cause\b|,\s*['"`]?cause['"`]?\s*:|\.\s*cause\s*=(?![=>])|\[\s*['"`]cause['"`]\s*\]\s*=(?![=>])/g;
const MESSAGE_PASSTHROUGH = /new\s+Error\(\s*[\w.]+\.(?:message|details|hint)\b/g;
const NEW_ERROR = /\bnew\s+\w*Error\s*\(/g;
const PROMISE_REJECT = /\bPromise\s*\.\s*reject\s*\(|(?<![.\w])reject\s*\(/g;
// A rejection argument is safe only as a fresh `new …Error(…)` (its own argument is checked by the
// dynamic-error rule) or a `toClientError(…)` result.
const SAFE_REJECTION = /^(?:new\s+\w*Error\s*\(|toClientError\s*\()/;

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'typeof',
  'case',
  'throw',
  'in',
  'of',
  'delete',
  'void',
  'new',
  'else',
  'do',
  'yield',
  'await'
]);

/** True when a `/` at the end of `code` starts a regex literal (previous significant token decides). */
function startsRegex(code) {
  const previous = code.trimEnd();
  if (previous === '') return true;
  const last = previous.at(-1);
  if (/[\w$]/.test(last)) return REGEX_PRECEDING_KEYWORDS.has(/[\w$]+$/.exec(previous)[0]);
  // `)` and `]` end an expression (division); everything else (operators, `(`, `,`, `{`, `}`, `;`) opens one.
  return !')]'.includes(last);
}

/** End index (exclusive, flags included) of the regex literal starting at `start`, or -1 when unterminated on the line. */
function regexEnd(text, start) {
  let inClass = false;
  for (let j = start + 1; j < text.length; j++) {
    const char = text[j];
    if (char === '\n') return -1;
    if (char === '\\') j++;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) {
      let end = j + 1;
      while (end < text.length && /[a-z]/i.test(text[end])) end++;
      return end;
    }
  }
  return -1;
}

/**
 * Lexes `text` once: returns the source with comments blanked (newlines kept) and the line comments
 * keyed by 1-based line. String, template and block-comment content is never mistaken for a line comment.
 */
function lexComments(text) {
  const lineComments = new Map();
  let code = '';
  let line = 1;
  let i = 0;
  const templateDepths = [];
  let braceDepth = 0;
  const blank = (segment) => segment.replace(/[^\n]/g, ' ');
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      lineComments.set(line, text.slice(i + 2, stop));
      code += blank(text.slice(i, stop));
      i = stop;
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      const segment = text.slice(i, stop);
      code += blank(segment);
      line += segment.split('\n').length - 1;
      i = stop;
    } else if (char === '/' && startsRegex(code) && regexEnd(text, i) !== -1) {
      // Regex literal: blanked so its body is never scanned and a `/` inside it never starts a comment.
      const stop = regexEnd(text, i);
      code += blank(text.slice(i, stop));
      i = stop;
    } else if (char === "'" || char === '"' || char === '`') {
      let j = i + 1;
      let inTemplateExpression = false;
      for (; j < text.length; j++) {
        if (text[j] === '\\') j++;
        else if (text[j] === char) break;
        else if (char === '`' && text[j] === '$' && text[j + 1] === '{') {
          inTemplateExpression = true;
          break;
        } else if (char !== '`' && text[j] === '\n') break;
      }
      if (inTemplateExpression) {
        code += text.slice(i, j + 2);
        templateDepths.push(braceDepth);
        braceDepth++;
        i = j + 2;
      } else {
        const segment = text.slice(i, j + 1);
        code += segment;
        line += segment.split('\n').length - 1;
        i = j + 1;
      }
    } else {
      if (char === '{') braceDepth++;
      else if (char === '}') {
        braceDepth--;
        if (templateDepths.length > 0 && templateDepths.at(-1) === braceDepth) {
          // Closing a `${…}`: resume the enclosing template literal.
          templateDepths.pop();
          let j = i + 1;
          for (; j < text.length; j++) {
            if (text[j] === '\\') j++;
            else if (text[j] === '`') break;
            else if (text[j] === '$' && text[j + 1] === '{') {
              templateDepths.push(braceDepth);
              braceDepth++;
              j++;
              break;
            }
          }
          const segment = text.slice(i, j + 1);
          code += segment;
          line += segment.split('\n').length - 1;
          i = j + 1;
          continue;
        }
      }
      if (char === '\n') line++;
      code += char;
      i++;
    }
  }
  return { code, lineComments };
}

/** True when `comment` is `guard-allow: <tag> <reason>` with an exact tag token and a non-empty reason. */
function isAllowComment(comment, tag) {
  const match = /^\s*guard-allow:\s*([\w-]+)\s+(\S[\s\S]*)$/.exec(comment ?? '');
  return match !== null && match[1] === tag;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** First call argument starting right after the opening paren at `start` (string/bracket aware). */
function firstArgument(code, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < code.length; i++) {
    const char = code[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if ('([{'.includes(char)) depth++;
    else if (depth === 0 && (char === ',' || char === ')')) return code.slice(start, i).trim();
    else if (')]}'.includes(char)) depth--;
  }
  return code.slice(start).trim();
}

function isLiteral(argument) {
  return /^'(?:[^'\\\n]|\\.)*'$|^"(?:[^"\\\n]|\\.)*"$|^`(?:[^`\\$]|\\.|\$(?!\{))*`$/.test(argument);
}

/** Returns { file, line, rule } findings; never echoes source text. */
export function scanServerFunctionErrors(sources) {
  const findings = [];
  for (const { file, text } of sources) {
    if (!SCANNED.test(file)) continue;
    const { code, lineComments } = lexComments(text);
    const allowed = (line, tag) =>
      [line, line - 1].some((candidate) => isAllowComment(lineComments.get(candidate), tag));
    const report = (index, rule, allowTag) => {
      const line = lineOf(code, index);
      if (allowTag && allowed(line, allowTag)) return;
      findings.push({ file, line, rule });
    };
    for (const match of code.matchAll(RAW_THROW)) report(match.index, 'raw-throw', 'raw-throw');
    const passthrough = new Set();
    for (const match of code.matchAll(MESSAGE_PASSTHROUGH)) {
      passthrough.add(match.index);
      report(match.index, 'error-message-passthrough');
    }
    for (const match of code.matchAll(RAW_CAUSE)) report(match.index, 'raw-cause', 'cause');
    for (const match of code.matchAll(PROMISE_REJECT)) {
      const isMethod = match[0].startsWith('Promise');
      const argument = firstArgument(code, match.index + match[0].length);
      if (isMethod || !SAFE_REJECTION.test(argument)) report(match.index, 'promise-reject');
    }
    if (file.replaceAll('\\', '/') !== BOUNDARY_FILE)
      for (const match of code.matchAll(NEW_ERROR)) {
        const argument = firstArgument(code, match.index + match[0].length);
        if (argument !== '' && !isLiteral(argument) && !passthrough.has(match.index))
          report(match.index, 'dynamic-error', 'dynamic-error');
      }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

async function collectSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => SCANNED.test(file));
  return Promise.all(
    files.map(async (file) => ({
      file: path.relative(root, file),
      text: await readFile(file, 'utf8')
    }))
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = scanServerFunctionErrors(await collectSources(path.join(root, 'src')));
  if (findings.length > 0) {
    for (const { file, line, rule } of findings)
      process.stderr.write('[server-function-errors] ' + file + ':' + line + ' ' + rule + '\n');
    process.stderr.write(
      'Wrap caught errors with toClientError (src/lib/client-error.server.ts).\n'
    );
    process.exit(1);
  }
}
