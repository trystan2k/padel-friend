import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'src/lib/supabase/database.types.ts');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr?.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

export async function generateTypes({
  check = false,
  fs = { mkdtemp, readFile, rename, rm, writeFile },
  runProcess = run,
  rootDir = root,
  destinationPath = destination
} = {}) {
  const scratchDir = await fs.mkdtemp(path.join(path.dirname(destinationPath), '.db-types-'));
  const candidatePath = path.join(scratchDir, 'database.types.ts');
  const configPath = path.join(scratchDir, 'oxfmt.json');
  try {
    const generated = await runProcess(
      'pnpm',
      [
        'exec',
        'supabase',
        'gen',
        'types',
        'typescript',
        '--local',
        '--schema',
        'public,storage,graphql_public'
      ],
      { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (generated.signal || generated.code !== 0)
      throw new Error(
        `Type generation failed${generated.signal ? ` (${generated.signal})` : ` (exit ${generated.code})`}: ${generated.stderr}`
      );
    if (!generated.stdout.trim()) throw new Error('Type generation returned empty output');
    await fs.writeFile(candidatePath, generated.stdout);
    const config = JSON.parse(await fs.readFile(path.join(rootDir, '.oxfmtrc.json'), 'utf8'));
    const override = config.overrides.find((item) =>
      item.files.includes('src/lib/supabase/database.types.ts')
    );
    await fs.writeFile(
      configPath,
      JSON.stringify({
        printWidth: config.printWidth,
        tabWidth: config.tabWidth,
        ...override.options
      })
    );
    const formatted = await runProcess(
      'pnpm',
      ['exec', 'oxfmt', '--config', configPath, '--write', candidatePath],
      { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (formatted.signal || formatted.code !== 0)
      throw new Error(
        `Type formatting failed${formatted.signal ? ` (${formatted.signal})` : ` (exit ${formatted.code})`}: ${formatted.stderr}`
      );
    const candidate = await fs.readFile(candidatePath);
    if (!candidate.length) throw new Error('Formatted type output is empty');
    if (check) {
      const existing = await fs.readFile(destinationPath);
      if (!candidate.equals(existing))
        throw new Error('Generated database types drifted. Run pnpm db:types to update them.');
      return;
    }
    await fs.rename(candidatePath, destinationPath);
  } finally {
    await fs.rm(scratchDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateTypes({ check: process.argv.includes('--check') }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
