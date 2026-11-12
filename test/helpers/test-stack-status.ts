// Fake `supabase status -o env` output for the isolated TEST stack. Values are synthetic: no real key,
// password or project secret ever appears in a test.
export const FAKE_SERVICE_KEY = 'fake-service-role-key';
export const FAKE_PUBLISHABLE_KEY = 'sb_publishable_fake';
export const FAKE_DB_URL = 'postgresql://postgres:fake-db-pw@127.0.0.1:55422/postgres';

export const TEST_STATUS_VALUES: Record<string, string> = {
  API_URL: 'http://127.0.0.1:55421',
  DB_URL: FAKE_DB_URL,
  STUDIO_URL: 'http://127.0.0.1:55423',
  MAILPIT_URL: 'http://127.0.0.1:55424',
  INBUCKET_URL: 'http://127.0.0.1:55424',
  PUBLISHABLE_KEY: FAKE_PUBLISHABLE_KEY,
  SECRET_KEY: 'sb_secret_fake',
  SERVICE_ROLE_KEY: FAKE_SERVICE_KEY
};

/** Status stdout (quoted KEY="value" lines like the CLI prints), with optional per-key overrides. */
export function testStatusOutput(overrides: Record<string, string | null> = {}): string {
  const merged: Record<string, string | null> = { ...TEST_STATUS_VALUES, ...overrides };
  return Object.entries(merged)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}="${value}"`)
    .join('\n');
}

/** The validated tuple the mapping above must produce. */
export const TEST_TUPLE = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:55421',
  VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_PUBLISHABLE_KEY,
  DATABASE_URL: FAKE_DB_URL,
  INTEGRATION_SUPABASE_DB_URL: FAKE_DB_URL,
  SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_KEY,
  MAILPIT_URL: 'http://127.0.0.1:55424'
};
