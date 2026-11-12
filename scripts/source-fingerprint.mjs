import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';

// Root env files are git-ignored but Vite inlines their VITE_ values into the build, so they are
// part of what a build came from.
export const BUILD_ENV_FILES = ['.env', '.env.local', '.env.production', '.env.production.local'];

const defaultGit = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
const defaultHashObjects = (input, cwd) =>
  execFileSync('git', ['hash-object', '--stdin-paths'], {
    cwd,
    encoding: 'utf8',
    input,
    maxBuffer: 1 << 28
  });

/**
 * Content hash of every non-ignored file (tracked + untracked), the build env files, the effective
 * test public tuple and HEAD. Build outputs are git-ignored, so this identifies the sources and public
 * backend a build came from. Symlinks (e.g. test/stack/supabase/migrations -> ../../../supabase/migrations,
 * a directory) are never passed to `git hash-object`, which cannot hash them: their link target text is
 * hashed instead, and the canonical files they point at are covered as ordinary tracked files.
 * Returns undefined when the sources cannot be fingerprinted (callers then fail closed to a rebuild).
 */
export function sourceFingerprint({
  tuple,
  cwd = process.cwd(),
  git = defaultGit,
  hashObjects = defaultHashObjects
} = {}) {
  try {
    const listed = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd)
      .split('\0')
      .filter((file) => file && existsSync(path.join(cwd, file)));
    const links = listed.filter((file) => lstatSync(path.join(cwd, file)).isSymbolicLink());
    const files = listed.filter((file) => !links.includes(file));
    const hash = createHash('sha256')
      .update(git(['rev-parse', 'HEAD'], cwd))
      .update(files.join('\n'))
      .update(hashObjects(files.join('\n'), cwd))
      .update(JSON.stringify(links.map((file) => [file, readlinkSync(path.join(cwd, file))])))
      .update(
        JSON.stringify([
          tuple?.VITE_SUPABASE_URL ?? null,
          tuple?.VITE_SUPABASE_PUBLISHABLE_KEY ?? null
        ])
      );
    for (const file of BUILD_ENV_FILES) {
      if (existsSync(path.join(cwd, file)))
        hash.update(file).update(readFileSync(path.join(cwd, file)));
    }
    return hash.digest('hex');
  } catch {
    return undefined;
  }
}
