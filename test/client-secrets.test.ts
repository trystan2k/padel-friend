import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanClientSecrets } from '../scripts/check-client-secrets.mjs';

const CANARY = 'canary-0123456789abcdef-secret';
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const serviceRoleJwt = `${b64({ alg: 'HS256' })}.${b64({ role: 'service_role' })}.sig`;
const anonJwt = `${b64({ alg: 'HS256' })}.${b64({ role: 'anon' })}.sig`;

let root: string;
let clientDir: string;
let sourceDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'client-secrets-'));
  clientDir = path.join(root, 'client');
  sourceDir = path.join(root, 'src');
  await mkdir(path.join(clientDir, 'assets'), { recursive: true });
  await mkdir(sourceDir, { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const scan = (secrets: string[] = [CANARY]) => scanClientSecrets({ clientDir, sourceDir, secrets });

describe('client secret guard', () => {
  it('passes a clean bundle that only holds the anon key', async () => {
    await writeFile(path.join(clientDir, 'assets/app.js'), `const k="${anonJwt}";`);
    await writeFile(path.join(sourceDir, 'route.ts'), "import x from './lib/other';");
    expect(await scan()).toEqual([]);
  });

  it('flags the injected canary without echoing it', async () => {
    await writeFile(path.join(clientDir, 'assets/app.js'), `const k="${CANARY}";`);
    const findings = await scan();
    expect(findings).toEqual([{ file: path.join('assets', 'app.js'), rule: 'secret-value' }]);
    expect(JSON.stringify(findings)).not.toContain(CANARY);
  });

  it('flags a service-role JWT in a source map', async () => {
    await writeFile(path.join(clientDir, 'assets/app.js.map'), `{"x":"${serviceRoleJwt}"}`);
    expect((await scan()).map((finding) => finding.rule)).toEqual(['service-role-jwt']);
  });

  it('flags the env name and secret key prefix in service worker assets', async () => {
    await writeFile(path.join(clientDir, 'sw.js'), 'self.SUPABASE_SERVICE_ROLE_KEY;');
    await writeFile(path.join(clientDir, 'assets/b.js'), 'x="sb_secret_abcdefghijklmnop1234"');
    const rules = (await scan()).map((finding) => finding.rule).sort();
    expect(rules).toEqual(['secret-key-prefix', 'service-role-env-name']);
  });

  it('flags a client module importing the admin client', async () => {
    await writeFile(
      path.join(sourceDir, 'Widget.tsx'),
      "import { getAdminClient } from '../lib/supabase/admin.server';"
    );
    await writeFile(
      path.join(sourceDir, 'thing.functions.ts'),
      "import { getAdminClient } from '../lib/supabase/admin.server';"
    );
    expect(await scan()).toEqual([{ file: 'Widget.tsx', rule: 'admin-client-import-boundary' }]);
  });
});
