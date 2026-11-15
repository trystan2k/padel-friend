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
//   promise-reject             `Promise.reject(…)` / `reject(<not new … / toClientError(…)>)`
//
// KNOWN LIMIT (documented, not pretended): a helper that RETURNS a rejecting promise built from an
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
const RAW_CAUSE = /\{\s*cause\b/g;
const MESSAGE_PASSTHROUGH = /new\s+Error\(\s*[\w.]+\.(?:message|details|hint)\b/g;
const NEW_ERROR = /\bnew\s+\w*Error\s*\(/g;
const PROMISE_REJECT =
  /\bPromise\s*\.\s*reject\s*\(|(?<![.\w])reject\s*\(\s*(?!new\b|toClientError\s*\()/g;

function blankComments(text) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + blank(match.slice(lead.length)));
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
    const code = blankComments(text);
    const rawLines = text.split('\n');
    const allowed = (line, tag) =>
      [rawLines[line - 1], rawLines[line - 2]].some((raw) => raw?.includes('guard-allow: ' + tag));
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
    for (const match of code.matchAll(PROMISE_REJECT)) report(match.index, 'promise-reject');
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
