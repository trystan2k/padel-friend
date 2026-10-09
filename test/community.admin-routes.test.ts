import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routeFiles = [
  '../src/routes/_protected.community.$communityId.admin.tsx',
  '../src/routes/_protected.community.$communityId.admin.requests.tsx',
  '../src/routes/_protected.community.$communityId.admin.members.tsx',
  '../src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx',
  '../src/routes/_protected.community.$communityId.admin.settings.tsx',
  '../src/routes/_protected.community.$communityId.admin.venues.tsx',
  '../src/routes/_protected.community.$communityId.admin.audit.tsx'
];

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('community admin routes', () => {
  it('attaches each admin view to the authenticated protected route tree', () => {
    const tree = source('../src/routeTree.gen.ts');
    expect(tree).toContain('getParentRoute: () => ProtectedRoute');
    for (const route of [
      '/community/$communityId/admin',
      '/community/$communityId/admin/requests',
      '/community/$communityId/admin/members',
      '/community/$communityId/admin/members/$membershipId',
      '/community/$communityId/admin/settings',
      '/community/$communityId/admin/venues',
      '/community/$communityId/admin/audit'
    ])
      expect(tree).toContain(route);
  });

  it('runs the explicit live-admin guard before each route reads private data', () => {
    for (const path of routeFiles) {
      const route = source(path);
      expect(route.includes('getCommunityAdminContext')).toBe(true);
      expect(route.includes('errorComponent: CommunityAdminDenied')).toBe(true);
    }
    const functions = source('../src/features/community/community-admin.functions.ts');
    expect(functions).toContain("client.rpc('is_community_admin'");
    expect(functions).toContain("if (!data) throw new Error('NOT_COMMUNITY_ADMIN')");
  });

  it('loads member detail by scoped membership ID and keeps roster pages status-scoped', () => {
    const detail = source(
      '../src/routes/_protected.community.$communityId.admin.members.$membershipId.tsx'
    );
    expect(detail).toContain('getCommunityMemberById');
    expect(detail).not.toContain('searchCommunityMembers');
    const members = source('../src/routes/_protected.community.$communityId.admin.members.tsx');
    expect(members).toContain("status: 'active'");
    expect(members).toContain('limit: 50');
    const requests = source('../src/routes/_protected.community.$communityId.admin.requests.tsx');
    expect(requests).toContain("status: 'pending'");
    const screen = source('../src/features/community/CommunityAdmin.tsx');
    expect(screen).toContain('status: filterStatus');
    expect(screen).toContain('offset,');
  });

  it('imports explicit module-level membership endpoints into the route-owned UI', () => {
    const ui = source('../src/features/community/CommunityAdmin.tsx');
    for (const endpoint of [
      'approveCommunityMember',
      'denyCommunityMember',
      'removeCommunityMember',
      'reactivateCommunityMember',
      'promoteCommunityMember',
      'demoteCommunityMember'
    ])
      expect(ui).toContain(endpoint);
  });
});
