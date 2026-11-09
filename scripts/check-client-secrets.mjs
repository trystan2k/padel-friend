import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Post-build guard: the service-role credential must never reach browser
// artifacts. Scans the built client output (JS, source maps, manifests, service
// worker) and the source import boundary. Findings name the file and rule only;
// secret values are never printed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT_ASSET = /\.(?:js|mjs|cjs|map|html|json|webmanifest|css|txt)$/;
const SOURCE_FILE = /\.(?:ts|tsx)$/;
const SERVER_IMPORTER = /\.(?:server|functions)\.tsx?$/;
const ADMIN_IMPORT = /from\s+['"][^'"]*admin\.server['"]/;
const JWT = /eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/g;
// supabase-js ships the bare `sb_secret_` prefix check; only a key body is a leak.
const SECRET_KEY = /sb_secret_[\w-]{16,}/;

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function hasServiceRoleJwt(contents) {
  for (const [, payload] of contents.matchAll(JWT)) {
    try {
      if (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role')
        return true;
    } catch {
      // Not a JWT payload; keep scanning.
    }
  }
  return false;
}

export async function scanClientSecrets({ clientDir, sourceDir, secrets = [] }) {
  const findings = [];
  const values = secrets.flatMap((value) => {
    if (typeof value !== 'string') return [];
    // Rotation keyrings are JSON maps; scan individual retained secrets, not only serialized JSON.
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return [value, ...Object.values(parsed)].filter(
          (item) => typeof item === 'string' && item.length >= 16
        );
    } catch {
      /* A scalar secret, not a keyring. */
    }
    return value.length >= 16 ? [value] : [];
  });
  for (const file of await files(clientDir)) {
    if (!TEXT_ASSET.test(file)) continue;
    const contents = await readFile(file, 'utf8');
    const relative = path.relative(clientDir, file);
    if (/WEB_PUSH_VAPID_PRIVATE_KEYS?/.test(contents))
      findings.push({ file: relative, rule: 'push-private-key-env-name' });
    if (contents.includes('SUPABASE_SERVICE_ROLE_KEY'))
      findings.push({ file: relative, rule: 'service-role-env-name' });
    if (SECRET_KEY.test(contents)) findings.push({ file: relative, rule: 'secret-key-prefix' });
    if (hasServiceRoleJwt(contents)) findings.push({ file: relative, rule: 'service-role-jwt' });
    if (values.some((value) => contents.includes(value)))
      findings.push({ file: relative, rule: 'secret-value' });
  }
  for (const file of await files(sourceDir)) {
    if (!SOURCE_FILE.test(file) || SERVER_IMPORTER.test(file)) continue;
    if (ADMIN_IMPORT.test(await readFile(file, 'utf8')))
      findings.push({ file: path.relative(sourceDir, file), rule: 'admin-client-import-boundary' });
  }
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  scanClientSecrets({
    clientDir: path.join(root, 'dist/client'),
    sourceDir: path.join(root, 'src'),
    secrets: [
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      process.env.CLIENT_SECRET_CANARY,
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
      process.env.WEB_PUSH_VAPID_PRIVATE_KEYS,
      process.env.PUSH_PRIVATE_KEY_CANARY
    ]
  }).then(
    (findings) => {
      if (findings.length === 0) return;
      for (const { file, rule } of findings)
        console.error(`client secret guard: ${rule} in ${file}`);
      process.exitCode = 1;
    },
    (error) => {
      console.error(`client secret guard failed: ${error.message}`);
      process.exitCode = 1;
    }
  );
}
