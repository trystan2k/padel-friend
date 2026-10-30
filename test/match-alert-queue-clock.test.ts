import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/20261029110000_match_result_notification_review_fixes.sql',
    import.meta.url
  ),
  'utf8'
);

describe('alert queue clock contract', () => {
  it.each([
    'sync_match_result_deadline_queue',
    'sync_match_result_entry_ready_queue',
    'touch_match_result_entry_ready_roster'
  ])('uses scheduler clock in %s', (name) => {
    const body = migration.split(`create function public.${name}()`)[1]?.split('end $$;')[0];
    expect(body).toContain('public.match_result_alert_clock()');
    expect(body).not.toContain('pg_catalog.clock_timestamp()');
  });
});
