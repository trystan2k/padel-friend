import * as stylex from '@stylexjs/stylex';
import { Link, Outlet, useParams, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { TextField } from '../../components/ui/TextField';
import {
  approveCommunityMember,
  archiveCommunityVenue,
  addCommunityVenue,
  demoteCommunityMember,
  denyCommunityMember,
  editCommunityVenue,
  listCommunityAudit,
  listCommunityVenues,
  promoteCommunityMember,
  reactivateCommunityMember,
  removeCommunityMember,
  searchCommunityMembers
} from './community-admin.functions';
import { updateCommunitySettings } from './community.functions';
import type { Database } from '../../lib/supabase/database.types';
import { styles } from './community-admin.styles';

type Context = {
  id: string;
  name: string;
  city_label: string | null;
  description: string | null;
  visibility: Database['public']['Enums']['community_visibility'];
  join_policy: Database['public']['Enums']['community_join_policy'];
};
type Member = Database['public']['Functions']['search_community_members']['Returns'][number];
type Venue = Pick<
  Database['public']['Tables']['community_venues']['Row'],
  | 'id'
  | 'community_id'
  | 'name'
  | 'address'
  | 'maps_url'
  | 'photo_path'
  | 'created_at'
  | 'updated_at'
  | 'archived_at'
>;
type Audit = Pick<
  Database['public']['Tables']['community_audit_log']['Row'],
  'id' | 'actor_user_id' | 'entity' | 'entity_id' | 'action' | 'details' | 'occurred_at'
>;
const EMPTY_MEMBERS: Member[] = [];
const EMPTY_VENUES: Venue[] = [];
type Screen = 'requests' | 'members' | 'member' | 'settings' | 'venues' | 'audit';

type Props = {
  screen: Screen;
  community: Context;
  members?: Member[];
  venues?: Venue[];
  audit?: Audit[];
  membershipId?: string;
};

function dateLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(value)
  );
}
function auditDateLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  }).format(new Date(value));
}
function auditEventKey(event: Audit) {
  const action = event.action.toLowerCase();
  const details = event.details;
  if (
    event.entity === 'community_members' &&
    action === 'insert' &&
    typeof details === 'object' &&
    details !== null &&
    'status' in details &&
    details.status === 'pending'
  )
    return 'communityAdmin.audit.requestCreated';
  if (event.entity === 'community_venues')
    return action === 'insert'
      ? 'communityAdmin.audit.venueAdded'
      : 'communityAdmin.audit.venueUpdated';
  if (event.entity === 'community_members')
    return action === 'insert'
      ? 'communityAdmin.audit.memberAdded'
      : 'communityAdmin.audit.memberUpdated';
  if (event.entity === 'communities') return 'communityAdmin.audit.settingsUpdated';
  if (event.entity === 'community_invitations')
    return action === 'insert'
      ? 'communityAdmin.audit.invitationAdded'
      : 'communityAdmin.audit.invitationUpdated';
  return 'communityAdmin.audit.unknown';
}
function auditMemberDetails(event: Audit) {
  if (event.entity !== 'community_members' || typeof event.details !== 'object' || !event.details)
    return null;
  const role =
    'role' in event.details && (event.details.role === 'admin' || event.details.role === 'member')
      ? event.details.role
      : null;
  const status =
    'status' in event.details &&
    (event.details.status === 'active' ||
      event.details.status === 'pending' ||
      event.details.status === 'inactive')
      ? event.details.status
      : null;
  return role && status ? { role, status } : null;
}
function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join('');
}
function failed(error: unknown) {
  if (!(error instanceof Error)) return 'generic';
  if (error.message === 'UNAUTHENTICATED') return 'session';
  if (error.message === 'FINAL_COMMUNITY_ADMIN') return 'finalAdmin';
  if (error.message === 'INVALID_MEMBERSHIP_TRANSITION') return 'transition';
  return 'generic';
}

export function CommunityAdminShell() {
  return (
    <main {...stylex.props(styles.page)}>
      <Outlet />
    </main>
  );
}

export function CommunityAdminDenied({ error }: { error?: unknown }) {
  const { t } = useTranslation();
  const denied = error instanceof Error && error.message === 'NOT_COMMUNITY_ADMIN';
  const missing = error instanceof Error && error.message === 'COMMUNITY_MEMBER_NOT_FOUND';
  return (
    <main {...stylex.props(styles.page)}>
      <SurfaceCard role="alert" xstyle={styles.card}>
        <h1 {...stylex.props(styles.title)}>
          {t(
            denied
              ? 'communityAdmin.accessDeniedTitle'
              : missing
                ? 'communityAdmin.title.member'
                : 'communityAdmin.errorTitle'
          )}
        </h1>
        <p {...stylex.props(styles.copy)}>
          {t(
            denied
              ? 'communityAdmin.accessDenied'
              : missing
                ? 'communityAdmin.empty.member'
                : 'communityAdmin.error.generic'
          )}
        </p>
      </SurfaceCard>
    </main>
  );
}

export function CommunityAdminLoading() {
  const { t } = useTranslation();
  return (
    <main {...stylex.props(styles.page)}>
      <output {...stylex.props(styles.copy)}>{t('communityAdmin.loading')}</output>
    </main>
  );
}

export function CommunityAdminEntries({
  communities
}: {
  communities: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  if (!communities.length) return null;
  return (
    <section
      aria-label={t('communityAdmin.yourCommunities')}
      {...stylex.props(styles.adminEntries)}
    >
      <h2 {...stylex.props(styles.sectionTitle)}>{t('communityAdmin.yourCommunities')}</h2>
      {communities.map((item) => (
        <Link
          key={item.id}
          to="/community/$communityId/admin/requests"
          params={{ communityId: item.id }}
          {...stylex.props(styles.adminEntryLink)}
        >
          {item.name}
        </Link>
      ))}
    </section>
  );
}

export function CommunityAdminScreen(props: Props) {
  return <CommunityAdminView key={props.community.id} {...props} />;
}

function CommunityAdminView({
  screen,
  community,
  members = EMPTY_MEMBERS,
  venues = EMPTY_VENUES,
  audit = [],
  membershipId
}: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useParams({ strict: false });
  const communityId = params.communityId ?? '';
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    query: string;
    status: Member['status'];
    rows: Member[];
    hasMore: boolean;
  } | null>(null);
  const [additionalRequests, setAdditionalRequests] = useState<Member[]>([]);
  const [hasLoadedMoreRequests, setHasLoadedMoreRequests] = useState(false);
  const [hasMoreRequests, setHasMoreRequests] = useState(members.length === 50);
  const [additionalVenues, setAdditionalVenues] = useState<Venue[]>([]);
  const [hasLoadedMoreVenues, setHasLoadedMoreVenues] = useState(false);
  const [hasMoreVenues, setHasMoreVenues] = useState(venues.length === 50);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasLoadedMoreMembers, setHasLoadedMoreMembers] = useState(false);
  const searchRequest = useRef(0);
  const hasSearchedMembers = useRef(false);
  const [additionalAudit, setAdditionalAudit] = useState<Audit[] | null>(null);
  const [hasMoreAudit, setHasMoreAudit] = useState(audit.length === 3);
  const [memberFilter, setMemberFilter] = useState<Member['status']>('active');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    action: 'demote' | 'remove';
    id: string;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [errorKey, setErrorKey] = useState('');
  const [settings, setSettings] = useState({
    name: community.name,
    description: community.description ?? '',
    city_label: community.city_label ?? '',
    visibility: community.visibility,
    join_policy: community.join_policy
  });
  const [venueDraft, setVenueDraft] = useState({ id: '', name: '', address: '', maps_url: '' });
  const [venueFormOpen, setVenueFormOpen] = useState(false);
  const locale = i18n.resolvedLanguage || i18n.language;
  const heading = t(`communityAdmin.title.${screen}`);
  const auditRows = additionalAudit === null ? audit : [...audit, ...additionalAudit];
  const navItems = [
    { key: 'requests', to: '/community/$communityId/admin/requests' },
    { key: 'members', to: '/community/$communityId/admin/members' },
    { key: 'settings', to: '/community/$communityId/admin/settings' },
    { key: 'venues', to: '/community/$communityId/admin/venues' },
    { key: 'audit', to: '/community/$communityId/admin/audit' }
  ] as const;
  const member = members.find((item) => item.membership_id === membershipId);
  const submittedQuery = query.trim();
  const currentSearch =
    searchResults?.query === submittedQuery && searchResults.status === memberFilter
      ? searchResults
      : null;
  const initialActiveResults = submittedQuery === '' && memberFilter === 'active' && !searchResults;
  const visibleMembers = currentSearch?.rows ?? (initialActiveResults ? members : []);
  const hasMoreMembers = currentSearch?.hasMore ?? (initialActiveResults && members.length === 50);
  const searchingMembers =
    searchLoading ||
    (!initialActiveResults && !currentSearch && searchResults !== null) ||
    (submittedQuery !== '' && !currentSearch) ||
    (memberFilter !== 'active' && !currentSearch);

  useEffect(() => {
    setAdditionalRequests([]);
    setHasLoadedMoreRequests(false);
    setHasMoreRequests(members.length === 50);
  }, [members]);
  useEffect(() => {
    setAdditionalVenues([]);
    setHasLoadedMoreVenues(false);
    setHasMoreVenues(venues.length === 50);
  }, [venues]);

  async function refresh() {
    setMessage('');
    setErrorKey('');
    await router.invalidate();
  }
  async function run(action: () => Promise<unknown>, success: string): Promise<unknown> {
    if (busy) return null;
    setBusy(true);
    setErrorKey('');
    setMessage('');
    try {
      const result = await action();
      setAdditionalRequests([]);
      setHasLoadedMoreRequests(false);
      setHasMoreRequests(members.length === 50);
      setAdditionalVenues([]);
      setHasLoadedMoreVenues(false);
      setHasMoreVenues(venues.length === 50);
      setMessage(success);
      try {
        await router.invalidate();
      } catch {
        setErrorKey('generic');
      }
      return result;
    } catch (error) {
      setErrorKey(failed(error));
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function memberAction(
    action: 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote',
    id: string
  ) {
    const data = { community_id: community.id, membership_id: id };
    const actions = {
      approve: approveCommunityMember,
      deny: denyCommunityMember,
      remove: removeCommunityMember,
      reactivate: reactivateCommunityMember,
      promote: promoteCommunityMember,
      demote: demoteCommunityMember
    };
    const result = await run(() => actions[action]({ data }), t(`communityAdmin.result.${action}`));
    if (
      action === 'reactivate' &&
      typeof result === 'object' &&
      result !== null &&
      'membership_id' in result &&
      typeof result.membership_id === 'string'
    )
      await router.navigate({
        to: '/community/$communityId/admin/members/$membershipId',
        params: { communityId: community.id, membershipId: result.membership_id }
      });
  }
  function requestMemberAction(
    action: 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote',
    id: string
  ) {
    if (action === 'remove' || action === 'demote') setConfirmation({ action, id });
    else void memberAction(action, id);
  }
  function confirmedAction(action: 'demote' | 'remove', id: string) {
    setConfirmation(null);
    void memberAction(action, id);
  }
  const actions = (person: Member, requestCard = false): ReactNode => (
    <div {...stylex.props(styles.actions, requestCard && styles.requestActions)}>
      {confirmation?.id === person.membership_id && (
        <>
          <output {...stylex.props(styles.copy)}>
            {t('communityAdmin.confirm', {
              action: t(`communityAdmin.action.${confirmation.action}`),
              name: person.display_name
            })}
          </output>
          <Button
            busy={busy}
            onClick={() => confirmedAction(confirmation.action, person.membership_id)}
          >
            {t('communityAdmin.confirmAction')}
          </Button>
          <Button variant="secondary" onClick={() => setConfirmation(null)}>
            {t('communityAdmin.cancel')}
          </Button>
        </>
      )}
      {person.status === 'pending' && (
        <>
          <Button busy={busy} onClick={() => requestMemberAction('approve', person.membership_id)}>
            {t('communityAdmin.action.approve')}
          </Button>
          <Button
            variant="secondary"
            busy={busy}
            onClick={() => requestMemberAction('deny', person.membership_id)}
          >
            {t('communityAdmin.action.deny')}
          </Button>
        </>
      )}
      {person.status === 'inactive' && (
        <Button busy={busy} onClick={() => requestMemberAction('reactivate', person.membership_id)}>
          {t('communityAdmin.action.reactivate')}
        </Button>
      )}
      {person.status === 'active' && person.role === 'member' && (
        <Button
          variant="secondary"
          busy={busy}
          xstyle={styles.softAction}
          onClick={() => requestMemberAction('promote', person.membership_id)}
        >
          {t('communityAdmin.action.promote')}
        </Button>
      )}
      {person.status === 'active' && person.role === 'admin' && (
        <Button
          variant="secondary"
          busy={busy}
          onClick={() => requestMemberAction('demote', person.membership_id)}
        >
          {t('communityAdmin.action.demote')}
        </Button>
      )}
      {person.status === 'active' && (
        <Button
          variant="secondary"
          busy={busy}
          onClick={() => requestMemberAction('remove', person.membership_id)}
        >
          {t('communityAdmin.action.remove')}
        </Button>
      )}
    </div>
  );
  const memberStatus = (person: Member) => t(`communityAdmin.status.${person.status}`);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(
      () => updateCommunitySettings({ data: { community_id: community.id, ...settings } }),
      t('communityAdmin.result.settings')
    );
  }
  async function saveVenue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = {
      community_id: community.id,
      name: venueDraft.name,
      address: venueDraft.address || null,
      maps_url: venueDraft.maps_url || null
    };
    const saved = await run(
      () =>
        venueDraft.id
          ? editCommunityVenue({ data: { ...data, venue_id: venueDraft.id } })
          : addCommunityVenue({ data }),
      t(venueDraft.id ? 'communityAdmin.result.venueUpdated' : 'communityAdmin.result.venueAdded')
    );
    if (!saved) return;
    setVenueFormOpen(false);
    setVenueDraft({ id: '', name: '', address: '', maps_url: '' });
  }
  const fetchMembers = useCallback(
    async (filterQuery: string, filterStatus: Member['status'], offset = 0) => {
      const requestId = ++searchRequest.current;
      hasSearchedMembers.current = true;
      setSearchLoading(true);
      setErrorKey('');
      try {
        const results = await searchCommunityMembers({
          data: {
            community_id: community.id,
            query: filterQuery,
            status: filterStatus,
            offset,
            limit: 50
          }
        });
        if (requestId !== searchRequest.current) return;
        setSearchResults((previous) => ({
          query: filterQuery,
          status: filterStatus,
          rows:
            offset > 0 && previous?.query === filterQuery && previous.status === filterStatus
              ? [...previous.rows, ...results]
              : results,
          hasMore: results.length === 50
        }));
      } catch (error) {
        if (requestId === searchRequest.current) setErrorKey(failed(error));
      } finally {
        if (requestId === searchRequest.current) setSearchLoading(false);
      }
    },
    [community.id]
  );
  useEffect(() => {
    if (submittedQuery === '' && memberFilter === 'active' && !hasSearchedMembers.current)
      return undefined;
    const timer = setTimeout(() => void fetchMembers(submittedQuery, memberFilter), 250);
    return () => clearTimeout(timer);
  }, [fetchMembers, submittedQuery, memberFilter]);
  async function loadMoreMembers() {
    if (searchLoading || !hasMoreMembers) return;
    setHasLoadedMoreMembers(true);
    if (currentSearch) {
      await fetchMembers(currentSearch.query, currentSearch.status, currentSearch.rows.length);
      return;
    }
    setSearchResults({ query: '', status: 'active', rows: members, hasMore: true });
    await fetchMembers('', 'active', members.length);
  }
  async function loadMoreRequests() {
    if (busy || !hasMoreRequests) return;
    setBusy(true);
    setHasLoadedMoreRequests(true);
    try {
      const page = await searchCommunityMembers({
        data: {
          community_id: community.id,
          query: '',
          status: 'pending',
          offset: members.length + additionalRequests.length,
          limit: 50
        }
      });
      setAdditionalRequests((previous) => [...previous, ...page]);
      setHasMoreRequests(page.length === 50);
    } catch (error) {
      setErrorKey(failed(error));
    } finally {
      setBusy(false);
    }
  }
  async function loadMoreVenues() {
    if (busy || !hasMoreVenues) return;
    setBusy(true);
    setHasLoadedMoreVenues(true);
    try {
      const page = await listCommunityVenues({
        data: {
          community_id: community.id,
          offset: venues.length + additionalVenues.length,
          limit: 50
        }
      });
      setAdditionalVenues((previous) => [...previous, ...page]);
      setHasMoreVenues(page.length === 50);
    } catch (error) {
      setErrorKey(failed(error));
    } finally {
      setBusy(false);
    }
  }
  async function loadMoreAudit() {
    if (busy || !hasMoreAudit) return;
    setBusy(true);
    try {
      const page = await listCommunityAudit({
        data: { community_id: community.id, offset: auditRows.length, limit: 3 }
      });
      setAdditionalAudit([...(additionalAudit ?? []), ...page]);
      setHasMoreAudit(page.length === 3);
    } catch (error) {
      setErrorKey(failed(error));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (screen === 'members') await fetchMembers(submittedQuery, memberFilter);
    else await refresh();
  }

  return (
    <section
      aria-labelledby="admin-screen-title"
      {...stylex.props(styles.content, screen === 'venues' && styles.venueContent)}
    >
      <header {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.screenHeading)}>
          <Link
            to="/dashboard"
            aria-label={t('communityAdmin.backToDashboard')}
            {...stylex.props(styles.backLink)}
          >
            <span aria-hidden="true">‹</span>
          </Link>
          <div {...stylex.props(styles.titleGroup)}>
            <h1 id="admin-screen-title" {...stylex.props(styles.title)}>
              {heading}
            </h1>
            <p {...stylex.props(styles.subtitle)}>
              {t('communityAdmin.communityAdminSubtitle', { community: community.name })}
            </p>
          </div>
        </div>
      </header>
      {screen === 'requests' && (
        <>
          <p {...stylex.props(styles.banner)}>{t('communityAdmin.requestBanner')}</p>
          <div {...stylex.props(styles.list)}>
            {[...members, ...additionalRequests].map((person) => (
              <SurfaceCard key={person.membership_id} xstyle={[styles.card, styles.requestCard]}>
                <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
                <p {...stylex.props(styles.copy)}>
                  {t('communityAdmin.levelLabel', {
                    level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                      person.display_level
                    ),
                    reliability: new Intl.NumberFormat(locale).format(person.reliability_percent)
                  })}
                </p>
                <p {...stylex.props(styles.copy, styles.requestMeta)}>
                  {t('communityAdmin.requestMeta', {
                    date: dateLabel(person.valid_from, locale),
                    privacy: t('communityAdmin.requestPrivacy')
                  })}
                </p>
                {actions(person, true)}
              </SurfaceCard>
            ))}
            {!members.length && !additionalRequests.length && (
              <p>{t('communityAdmin.empty.requests')}</p>
            )}
            {hasMoreRequests ? (
              <Button variant="secondary" busy={busy} onClick={() => void loadMoreRequests()}>
                {t('communityAdmin.loadMore')}
              </Button>
            ) : (
              hasLoadedMoreRequests && (
                <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
              )
            )}
            <p {...stylex.props(styles.note)}>{t('communityAdmin.requestHistoryUnavailable')}</p>
          </div>
        </>
      )}
      {screen === 'members' && (
        <>
          <Button disabled xstyle={styles.unavailableInvite}>
            {t('communityAdmin.inviteUnavailable')}
          </Button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
            }}
            {...stylex.props(styles.searchForm)}
          >
            <div {...stylex.props(styles.searchField)}>
              <TextField
                id="admin-member-search"
                label={
                  <span {...stylex.props(styles.visuallyHidden)}>
                    {t('communityAdmin.searchLabel')}
                  </span>
                }
                type="search"
                value={query}
                placeholder={t('communityAdmin.searchPlaceholder')}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </form>
          <div aria-label={t('communityAdmin.memberFilters')} {...stylex.props(styles.filterTabs)}>
            {(['active', 'pending', 'inactive'] as const).map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={memberFilter === status}
                onClick={() => {
                  setMemberFilter(status);
                }}
                {...stylex.props(
                  styles.filterTab,
                  memberFilter === status && styles.filterTabSelected
                )}
              >
                {t(`communityAdmin.status.${status}`)}
              </button>
            ))}
          </div>
          {searchingMembers && (
            <output aria-live="polite" {...stylex.props(styles.copy)}>
              {t('communityAdmin.searchLoading')}
            </output>
          )}
          <div {...stylex.props(styles.list, styles.memberList)}>
            {visibleMembers.map((person) => (
              <SurfaceCard
                key={person.membership_id}
                data-testid="community-member-card"
                xstyle={[styles.card, styles.memberCard]}
              >
                <span aria-hidden="true" {...stylex.props(styles.avatar)}>
                  {initials(person.display_name)}
                </span>
                <div {...stylex.props(styles.memberDetails)}>
                  <div {...stylex.props(styles.memberRowHeader)}>
                    <Link
                      to="/community/$communityId/admin/members/$membershipId"
                      params={{ communityId, membershipId: person.membership_id }}
                      {...stylex.props(styles.memberLink)}
                    >
                      <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
                    </Link>
                    <span {...stylex.props(styles.roleBadge)}>
                      {t(`communityAdmin.role.${person.role}`)}
                    </span>
                  </div>
                  <p {...stylex.props(styles.copy)}>
                    {t('communityAdmin.memberJoined', {
                      date: dateLabel(person.valid_from, locale)
                    })}
                  </p>
                  <p {...stylex.props(styles.copy)}>
                    {t('communityAdmin.levelLabel', {
                      level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                        person.display_level
                      ),
                      reliability: new Intl.NumberFormat(locale).format(person.reliability_percent)
                    })}
                  </p>
                </div>
              </SurfaceCard>
            ))}
            {!visibleMembers.length && !searchingMembers && (
              <p>{t('communityAdmin.empty.members')}</p>
            )}
          </div>
          {hasMoreMembers ? (
            <Button variant="secondary" busy={searchLoading} onClick={() => void loadMoreMembers()}>
              {t('communityAdmin.loadMore')}
            </Button>
          ) : (
            hasLoadedMoreMembers && (
              <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
            )
          )}
          <p {...stylex.props(styles.note)}>{t('communityAdmin.levelReadOnly')}</p>
        </>
      )}
      {screen === 'member' && (
        <>
          {member?.status === 'active' && (
            <p {...stylex.props(styles.banner)}>{t('communityAdmin.memberActiveBanner')}</p>
          )}
          {member ? (
            <>
              <SurfaceCard
                data-testid="community-member-profile"
                xstyle={[styles.card, styles.memberProfileCard]}
              >
                <h3 {...stylex.props(styles.memberProfileTitle)}>
                  {t('communityAdmin.memberAdminProfile', {
                    name: member.display_name,
                    level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                      member.display_level
                    ),
                    reliability: new Intl.NumberFormat(locale).format(member.reliability_percent)
                  })}
                </h3>
                <p {...stylex.props(styles.copy)}>
                  {t('communityAdmin.memberMeta', {
                    status: memberStatus(member),
                    role: t(`communityAdmin.role.${member.role}`),
                    date: dateLabel(member.valid_from, locale)
                  })}
                </p>
              </SurfaceCard>
              <SurfaceCard data-testid="community-member-role-panel" xstyle={styles.rolePanel}>
                <p {...stylex.props(styles.rolePanelTitle)}>{t('communityAdmin.rolePanelTitle')}</p>
                <p {...stylex.props(styles.rolePanelCopy)}>
                  {t('communityAdmin.rolePanelActive', {
                    role: t(`communityAdmin.role.${member.role}`)
                  })}
                </p>
                <p {...stylex.props(styles.rolePanelCopy)}>
                  {t('communityAdmin.rolePanelInactive')}
                </p>
              </SurfaceCard>
              <div {...stylex.props(styles.form)}>{actions(member)}</div>
            </>
          ) : (
            <SurfaceCard xstyle={styles.card}>
              <p>{t('communityAdmin.empty.member')}</p>
            </SurfaceCard>
          )}
          <p {...stylex.props(styles.note)}>{t('communityAdmin.levelReadOnly')}</p>
        </>
      )}
      {screen === 'settings' && (
        <form
          onSubmit={(event) => void saveSettings(event)}
          {...stylex.props(styles.form, styles.settingsForm)}
        >
          <SurfaceCard data-testid="settings-visibility-label" xstyle={styles.settingsCard}>
            <span {...stylex.props(styles.fieldLabel)}>
              {t('communityAdmin.settings.visibility')}
            </span>
          </SurfaceCard>
          <select
            id="community-visibility"
            data-testid="settings-visibility-control"
            value={settings.visibility}
            aria-label={t('communityAdmin.settings.visibility')}
            onChange={(event) =>
              setSettings({
                ...settings,
                visibility: event.target.value === 'public' ? 'public' : 'private'
              })
            }
            {...stylex.props(styles.settingChoice)}
          >
            <option value="public">{t('communityAdmin.visibility.public')}</option>
            <option value="private">{t('communityAdmin.visibility.private')}</option>
          </select>
          <select
            id="community-join-policy"
            data-testid="settings-join-policy-control"
            value={settings.join_policy}
            aria-label={t('communityAdmin.settings.joinPolicy')}
            onChange={(event) =>
              setSettings({
                ...settings,
                join_policy: event.target.value === 'instant' ? 'instant' : 'admin_approval'
              })
            }
            {...stylex.props(styles.settingChoice)}
          >
            <option value="instant">{t('communityAdmin.joinPolicy.instant')}</option>
            <option value="admin_approval">{t('communityAdmin.joinPolicy.adminApproval')}</option>
          </select>
          <SurfaceCard xstyle={styles.settingsUnavailableCard}>
            <p {...stylex.props(styles.copy)}>{t('communityAdmin.settingsUnavailable')}</p>
            <details {...stylex.props(styles.details)}>
              <summary {...stylex.props(styles.detailsSummary)}>
                {t('communityAdmin.settings.details')}
              </summary>
              <div {...stylex.props(styles.form)}>
                <TextField
                  id="community-admin-name"
                  label={t('communityAdmin.settings.name')}
                  value={settings.name}
                  maxLength={80}
                  onChange={(event) => setSettings({ ...settings, name: event.target.value })}
                  required
                />
                <TextField
                  id="community-admin-city"
                  label={t('communityAdmin.settings.city')}
                  value={settings.city_label}
                  maxLength={120}
                  onChange={(event) => setSettings({ ...settings, city_label: event.target.value })}
                />
                <TextField
                  id="community-admin-description"
                  label={t('communityAdmin.settings.description')}
                  value={settings.description}
                  maxLength={500}
                  onChange={(event) =>
                    setSettings({ ...settings, description: event.target.value })
                  }
                />
              </div>
            </details>
          </SurfaceCard>
          <Button type="submit" busy={busy}>
            {t('communityAdmin.save')}
          </Button>
          <p {...stylex.props(styles.note)}>{t('communityAdmin.settingsAdminNote')}</p>
        </form>
      )}
      {screen === 'venues' && (
        <>
          {!venueFormOpen && (
            <>
              <Button onClick={() => setVenueFormOpen(true)}>
                {t('communityAdmin.venue.add')}
              </Button>
            </>
          )}
          {venueFormOpen && (
            <SurfaceCard xstyle={styles.card}>
              <h3 {...stylex.props(styles.cardTitle)}>
                {t(venueDraft.id ? 'communityAdmin.venue.edit' : 'communityAdmin.venue.add')}
              </h3>
              <form onSubmit={(event) => void saveVenue(event)} {...stylex.props(styles.form)}>
                <TextField
                  id="venue-name"
                  label={t('communityAdmin.venue.name')}
                  value={venueDraft.name}
                  maxLength={120}
                  required
                  onChange={(event) => setVenueDraft({ ...venueDraft, name: event.target.value })}
                />
                <TextField
                  id="venue-address"
                  label={t('communityAdmin.venue.address')}
                  value={venueDraft.address}
                  maxLength={300}
                  onChange={(event) =>
                    setVenueDraft({ ...venueDraft, address: event.target.value })
                  }
                />
                <TextField
                  id="venue-map"
                  label={t('communityAdmin.venue.mapsUrl')}
                  value={venueDraft.maps_url}
                  maxLength={2048}
                  type="url"
                  onChange={(event) =>
                    setVenueDraft({ ...venueDraft, maps_url: event.target.value })
                  }
                />
                <p {...stylex.props(styles.note)}>{t('communityAdmin.photoUnavailable')}</p>
                <Button type="submit" busy={busy}>
                  {t('communityAdmin.save')}
                </Button>
              </form>
              <Button
                variant="secondary"
                onClick={() => {
                  setVenueFormOpen(false);
                  setVenueDraft({ id: '', name: '', address: '', maps_url: '' });
                }}
              >
                {t('communityAdmin.cancel')}
              </Button>
            </SurfaceCard>
          )}
          <div {...stylex.props(styles.list)}>
            {[...venues, ...additionalVenues].map((venue) => (
              <SurfaceCard
                key={venue.id}
                data-testid="community-venue-card"
                xstyle={[styles.card, styles.venueCard]}
              >
                <h3 {...stylex.props(styles.cardCompactTitle)}>{venue.name}</h3>
                <div {...stylex.props(styles.venueMeta)}>
                  <p {...stylex.props(styles.copy)}>
                    {venue.address || community.city_label || t('communityAdmin.cityUnavailable')}
                  </p>
                  {venue.maps_url && (
                    <a
                      href={venue.maps_url}
                      target="_blank"
                      rel="noreferrer"
                      {...stylex.props(styles.memberLink, styles.venueMapLink)}
                    >
                      {t('communityAdmin.venue.openMap')}
                    </a>
                  )}
                </div>
                <div {...stylex.props(styles.venueActions)}>
                  <Button
                    variant="secondary"
                    xstyle={styles.venueAction}
                    onClick={() => {
                      setVenueDraft({
                        id: venue.id,
                        name: venue.name,
                        address: venue.address ?? '',
                        maps_url: venue.maps_url ?? ''
                      });
                      setVenueFormOpen(true);
                    }}
                  >
                    {t('communityAdmin.venue.edit')}
                  </Button>
                  <Button
                    variant="secondary"
                    xstyle={styles.venueAction}
                    busy={busy}
                    onClick={() =>
                      void run(
                        () =>
                          archiveCommunityVenue({
                            data: { community_id: community.id, venue_id: venue.id }
                          }),
                        t('communityAdmin.result.venueArchived')
                      )
                    }
                  >
                    {t('communityAdmin.venue.archive')}
                  </Button>
                </div>
              </SurfaceCard>
            ))}
            {!venues.length && !additionalVenues.length && (
              <p>{t('communityAdmin.empty.venues')}</p>
            )}
          </div>
          {hasMoreVenues ? (
            <Button variant="secondary" busy={busy} onClick={() => void loadMoreVenues()}>
              {t('communityAdmin.loadMore')}
            </Button>
          ) : (
            hasLoadedMoreVenues && (
              <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
            )
          )}
          <p {...stylex.props(styles.note)}>{t('communityAdmin.venue.historyNote')}</p>
        </>
      )}
      {screen === 'audit' && (
        <div {...stylex.props(styles.list)}>
          <p {...stylex.props(styles.banner)}>{t('communityAdmin.audit.recentChanges')}</p>
          {auditRows.map((event) => (
            <SurfaceCard
              key={event.id}
              data-testid="community-audit-event"
              xstyle={[styles.card, styles.auditCard]}
            >
              <p {...stylex.props(styles.auditAction)}>
                {t(auditEventKey(event), { defaultValue: t('communityAdmin.audit.unknown') })}
                {auditMemberDetails(event) &&
                  ` · ${t(`communityAdmin.role.${auditMemberDetails(event)?.role}`)} · ${t(`communityAdmin.status.${auditMemberDetails(event)?.status}`)}`}
              </p>
              <p {...stylex.props(styles.copy)}>
                {t('communityAdmin.audit.unknownActor')} ·{' '}
                {auditDateLabel(event.occurred_at, locale)}
              </p>
              {event.entity === 'community_members' && (
                <Link
                  to="/community/$communityId/admin/members/$membershipId"
                  params={{ communityId, membershipId: event.entity_id }}
                  {...stylex.props(styles.memberLink)}
                >
                  {t('communityAdmin.audit.openMember')}
                </Link>
              )}
            </SurfaceCard>
          ))}
          {!auditRows.length && <p>{t('communityAdmin.empty.audit')}</p>}
          {hasMoreAudit && (
            <Button variant="secondary" busy={busy} onClick={() => void loadMoreAudit()}>
              {t('communityAdmin.loadMore')}
            </Button>
          )}
        </div>
      )}
      {message && <output {...stylex.props(styles.status)}>{message}</output>}
      {errorKey && (
        <p role="alert" {...stylex.props(styles.error)}>
          {t(`communityAdmin.error.${errorKey}`)}
        </p>
      )}
      {errorKey && (
        <Button variant="secondary" onClick={() => void retry()}>
          {t('communityAdmin.retry')}
        </Button>
      )}
      <nav aria-label={t('communityAdmin.navigation')} {...stylex.props(styles.bottomNav)}>
        {navItems.map((item) => (
          <Link
            key={item.key}
            to={item.to}
            params={{ communityId }}
            aria-current={screen === item.key ? 'page' : undefined}
            {...stylex.props(styles.bottomNavLink)}
          >
            {t(`communityAdmin.nav.${item.key}`)}
          </Link>
        ))}
      </nav>
    </section>
  );
}
