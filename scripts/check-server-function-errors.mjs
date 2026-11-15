import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Static guard (PAF-187): server functions and their server helpers must never rethrow a raw
// database/provider error. A PostgREST error serializes SQLSTATE, details and hint into the client
// response; every failure has to go through toClientError (or a fresh `new Error('<CODE>')`).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED = /\.(?:functions|server)\.ts$/;
const FUNCTIONS = /\.functions\.ts$/;
// `throw` followed by anything other than `new …` or `toClientError(…)`; \s covers multiline forms.
const RAW_THROW = /\bthrow\s+(?!new\b|toClientError\s*\()/g;
// Wrapping the raw error as `cause` keeps it on the thrown object; functions must drop it.
const RAW_CAUSE = /\{\s*cause\b/g;
const MESSAGE_PASSTHROUGH = /new\s+Error\(\s*[\w.]+\.(?:message|details|hint)\b/g;

function blankComments(text) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + blank(match.slice(lead.length)));
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** Returns { file, line, rule } findings; never echoes source text. */
export function scanServerFunctionErrors(sources) {
  const findings = [];
  for (const { file, text } of sources) {
    if (!SCANNED.test(file)) continue;
    const code = blankComments(text);
    const rules = [
      ['raw-throw', RAW_THROW],
      ['error-message-passthrough', MESSAGE_PASSTHROUGH],
      ...(FUNCTIONS.test(file) ? [['raw-cause', RAW_CAUSE]] : [])
    ];
    for (const [rule, pattern] of rules)
      for (const match of code.matchAll(pattern))
        findings.push({ file, line: lineOf(code, match.index), rule });
  }
  return findings;
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
  const findings = scanServerFunctionErrors(await collectSources(path.join(root, 'src/features')));
  if (findings.length > 0) {
    for (const { file, line, rule } of findings)
      process.stderr.write(`[server-function-errors] ${file}:${line} ${rule}\n`);
    process.stderr.write(
      'Wrap caught errors with toClientError (src/lib/client-error.server.ts).\n'
    );
    process.exit(1);
  }
}
