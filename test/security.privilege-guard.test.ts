import { describe, expect, it } from 'vitest';
import {
  PRIVILEGE_ALLOWLISTS,
  classifyPrivilegeViolations,
  type PrivilegeCatalog
} from './helpers/privilege-guard';

const clean: PrivilegeCatalog = {
  anonSecurityDefinerFunctions: [],
  tablesWithoutRls: [],
  anonTableGrants: []
};

describe('privilege guard classifier', () => {
  it('accepts a clean catalog', () => {
    expect(classifyPrivilegeViolations(clean)).toEqual([]);
  });

  it('flags each violation class', () => {
    expect(
      classifyPrivilegeViolations({
        anonSecurityDefinerFunctions: ['public.leak(uuid)'],
        tablesWithoutRls: ['public.open_table'],
        anonTableGrants: [
          { relation: 'public.open_table', column: null, privilege: 'TRUNCATE' },
          { relation: 'public.p', column: 'secret', privilege: 'SELECT' }
        ]
      })
    ).toEqual([
      { rule: 'anon-definer-execute', subject: 'public.leak(uuid)' },
      { rule: 'no-rls', subject: 'public.open_table' },
      { rule: 'anon-grant', subject: 'public.open_table:TRUNCATE' },
      { rule: 'anon-grant', subject: 'public.p.secret:SELECT' }
    ]);
  });

  it('honors only exact fully qualified allowlist entries', () => {
    const allowlists = {
      anonSecurityDefinerFunctions: { 'public.ok(uuid)': 'public lookup' },
      tablesWithoutRls: { 'public.lookup': 'static data' },
      anonTableGrants: { 'public.lookup:SELECT': 'static data' }
    };
    expect(
      classifyPrivilegeViolations(
        {
          anonSecurityDefinerFunctions: ['public.ok(uuid)', 'public.ok(text)'],
          tablesWithoutRls: ['public.lookup', 'other.lookup'],
          anonTableGrants: [
            { relation: 'public.lookup', column: null, privilege: 'SELECT' },
            { relation: 'public.lookup', column: null, privilege: 'INSERT' }
          ]
        },
        allowlists
      )
    ).toEqual([
      { rule: 'anon-definer-execute', subject: 'public.ok(text)' },
      { rule: 'no-rls', subject: 'other.lookup' },
      { rule: 'anon-grant', subject: 'public.lookup:INSERT' }
    ]);
  });

  it('ships with no blanket exceptions', () => {
    expect(PRIVILEGE_ALLOWLISTS).toEqual({
      anonSecurityDefinerFunctions: {},
      tablesWithoutRls: {},
      anonTableGrants: {}
    });
  });
});
