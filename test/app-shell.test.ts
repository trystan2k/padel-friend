import { describe, expect, it } from 'vitest';
import { resolveAppShell } from '../src/features/app-shell/app-shell';

const event = '00000000-0000-4000-8000-0000000000e1';
const community = '00000000-0000-4000-8000-0000000000c1';

describe('resolveAppShell active destination', () => {
  it.each([
    ['/dashboard', '', 'home'],
    ['/community', '', 'community'],
    [`/community/${community}`, '', 'community'],
    [`/community/${community}/ranking`, '', 'community'],
    ['/notifications', '', 'home'],
    ['/notifications/preferences', '', 'home'],
    ['/matches', '', 'matches'],
    ['/matches/', '', 'matches'],
    ['/matches/my', '', 'matches'],
    ['/matches/past', '', 'matches'],
    [`/community/${community}/statistics`, '', 'community'],
    [`/community/${community}/leagues`, '', 'community'],
    [`/community/${community}/admin/members`, '', 'community'],
    ['/me', '', 'me'],
    ['/players/p1', '', 'me'],
    ['/level-reviews', '', 'me'],
    ['/platform-admin/result-repairs', '', 'me']
  ])('%s %s highlights %s', (path, _hash, active) => {
    expect(resolveAppShell(path).active).toBe(active);
  });

  it('has no current tab for routes outside the destinations', () => {
    expect(resolveAppShell('/privacy').active).toBeNull();
    expect(resolveAppShell('/').active).toBeNull();
  });
});

describe('resolveAppShell visibility', () => {
  it.each([
    '/dashboard',
    '/me',
    '/matches',
    '/matches/my',
    '/matches/past',
    `/community/${community}`,
    `/community/${community}/ranking`,
    `/community/${community}/repairs`,
    '/platform-admin/result-repairs'
  ])('keeps the bar on %s', (path) => {
    expect(resolveAppShell(path).visible).toBe(true);
  });

  it.each([
    // Create wizard, match detail and the whole result-recording flow
    '/matches/create',
    `/matches/${event}`,
    `/matches/${event}/record`,
    `/matches/${event}/groups/g1`,
    // Audited nested index screens whose frames draw a top bar and no tab bar
    '/level-reviews', // A9f626
    '/platform-admin/level-reviews', // SCPeI
    '/notifications', // cAqsQ
    '/notifications/preferences', // y8ErQ
    '/players/p1', // RN0yw
    `/community/${community}/statistics`, // o9iaC1
    `/community/${community}/leagues`, // Fj5bc
    // Nested and wizard screens elsewhere
    `/community/${community}/leagues/create`,
    `/community/${community}/leagues/l1`,
    `/notifications/n1`,
    '/level-reviews/new',
    '/level-reviews/r1',
    '/platform-admin/level-reviews/r1',
    '/players/p1/opponents/p2',
    '/players/p1/partners/p2',
    // Admin owns its own section bar until its redesign
    `/community/${community}/admin`,
    `/community/${community}/admin/members/m1`
  ])('suppresses the bar on %s', (path) => {
    expect(resolveAppShell(path).visible).toBe(false);
  });
});
