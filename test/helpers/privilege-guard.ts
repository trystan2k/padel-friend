export type PrivilegeCatalog = {
  anonSecurityDefinerFunctions: string[];
  tablesWithoutRls: string[];
  anonTableGrants: Array<{ relation: string; column: string | null; privilege: string }>;
};
export type PrivilegeViolation = {
  rule: 'anon-definer-execute' | 'no-rls' | 'anon-grant';
  subject: string;
};
export type PrivilegeAllowlists = {
  /** Fully qualified signatures, e.g. `public.fn(uuid)`, mapped to the reason anon needs EXECUTE. */
  anonSecurityDefinerFunctions: Record<string, string>;
  /** Fully qualified relation names mapped to the reason public RLS is intentionally off. */
  tablesWithoutRls: Record<string, string>;
  /** `relation:PRIVILEGE` (table-level) or `relation.column:PRIVILEGE` mapped to a reason. */
  anonTableGrants: Record<string, string>;
};

/**
 * No exceptions today. `public.touch_player_updated_at()` is deliberately NOT listed: it is a
 * plain (non-SECURITY DEFINER) trigger function and trigger firing does not check EXECUTE for
 * the updating role, so anon/authenticated/PUBLIC execution was revoked.
 */
export const PRIVILEGE_ALLOWLISTS: PrivilegeAllowlists = {
  anonSecurityDefinerFunctions: {},
  tablesWithoutRls: {},
  anonTableGrants: {}
};

export const grantKey = (grant: PrivilegeCatalog['anonTableGrants'][number]) =>
  `${grant.column ? `${grant.relation}.${grant.column}` : grant.relation}:${grant.privilege}`;

export function classifyPrivilegeViolations(
  catalog: PrivilegeCatalog,
  allowlists: PrivilegeAllowlists = PRIVILEGE_ALLOWLISTS
): PrivilegeViolation[] {
  return [
    ...catalog.anonSecurityDefinerFunctions
      .filter((subject) => !(subject in allowlists.anonSecurityDefinerFunctions))
      .map((subject) => ({ rule: 'anon-definer-execute' as const, subject })),
    ...catalog.tablesWithoutRls
      .filter((subject) => !(subject in allowlists.tablesWithoutRls))
      .map((subject) => ({ rule: 'no-rls' as const, subject })),
    ...catalog.anonTableGrants
      .map(grantKey)
      .filter((subject) => !(subject in allowlists.anonTableGrants))
      .map((subject) => ({ rule: 'anon-grant' as const, subject }))
  ];
}

type Query = (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;

// Extension-owned objects (pg_depend deptype 'e') are not application surface.
const NOT_EXTENSION_MEMBER = (oid: string, catalog: string) =>
  `not exists (select 1 from pg_depend d where d.classid = '${catalog}'::regclass and d.objid = ${oid} and d.deptype = 'e')`;

const RELATION_NAME = "format('%I.%I', n.nspname, c.relname)";

/** Reads effective (PUBLIC-inherited included) anon exposure of the public schema. */
export async function readPrivilegeCatalog(query: Query): Promise<PrivilegeCatalog> {
  // Sequential: a dedicated connection allows one query in flight.
  const functions =
    await query(`select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as subject
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and has_function_privilege('anon', p.oid, 'EXECUTE')
         and ${NOT_EXTENSION_MEMBER('p.oid', 'pg_proc')}
       order by 1`);
  const tables = await query(`select ${RELATION_NAME} as subject
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
         and ${NOT_EXTENSION_MEMBER('c.oid', 'pg_class')}
       order by 1`);
  const grants =
    await query(`select ${RELATION_NAME} as relation, null::text as "column", t.privilege
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as t(privilege)
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and has_table_privilege('anon', c.oid, t.privilege)
         and ${NOT_EXTENSION_MEMBER('c.oid', 'pg_class')}
       union all
       select ${RELATION_NAME}, a.attname::text, t.privilege
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) as t(privilege)
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and has_column_privilege('anon', c.oid, a.attnum, t.privilege)
         and not has_table_privilege('anon', c.oid, t.privilege)
         and ${NOT_EXTENSION_MEMBER('c.oid', 'pg_class')}
       order by 1, 2, 3`);
  return {
    anonSecurityDefinerFunctions: functions.rows.map((row) => String(row.subject)),
    tablesWithoutRls: tables.rows.map((row) => String(row.subject)),
    anonTableGrants: grants.rows.map((row) => ({
      relation: String(row.relation),
      column: typeof row.column === 'string' ? row.column : null,
      privilege: String(row.privilege)
    }))
  };
}
