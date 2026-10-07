import * as stylex from '@stylexjs/stylex';
import { Link, Outlet, useParams, useRouter } from '@tanstack/react-router';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
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
type Venue = Database['public']['Tables']['community_venues']['Row'];
type Audit = Pick<
  Database['public']['Tables']['community_audit_log']['Row'],
  'id' | 'actor_user_id' | 'entity' | 'entity_id' | 'action' | 'details' | 'occurred_at'
>;
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
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
}
function auditEventKey(event: Audit) {
  const action = event.action.toLowerCase();
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
  return (
    <main {...stylex.props(styles.page)}>
      <SurfaceCard role="alert" xstyle={styles.card}>
        <h1 {...stylex.props(styles.title)}>
          {t(denied ? 'communityAdmin.accessDeniedTitle' : 'communityAdmin.errorTitle')}
        </h1>
        <p {...stylex.props(styles.copy)}>
          {t(denied ? 'communityAdmin.accessDenied' : 'communityAdmin.error.generic')}
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

export function CommunityAdminScreen({
  screen,
  community,
  members = [],
  venues = [],
  audit = [],
  membershipId
}: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useParams({ strict: false });
  const communityId = params.communityId ?? '';
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Member[] | null>(null);
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
  const visibleMembers = useMemo(
    () =>
      (searchResults ?? members).filter(
        (item) =>
          item.status === memberFilter &&
          item.display_name
            .toLocaleLowerCase(locale)
            .includes(query.trim().toLocaleLowerCase(locale))
      ),
    [locale, memberFilter, members, query, searchResults]
  );

  async function refresh() {
    setMessage('');
    setErrorKey('');
    await router.invalidate();
  }
  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setErrorKey('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      await router.invalidate();
      return true;
    } catch (error) {
      setErrorKey(failed(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function memberAction(
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
    return run(() => actions[action]({ data }), t(`communityAdmin.result.${action}`));
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
  const actions = (person: Member): ReactNode => (
    <div {...stylex.props(styles.actions)}>
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
  async function search(filterStatus = memberFilter) {
    if (busy) return;
    setBusy(true);
    try {
      const results = await searchCommunityMembers({
        data: { community_id: community.id, query, status: filterStatus, offset: 0, limit: 50 }
      });
      setSearchResults(results);
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

  return (
    <section aria-labelledby="admin-screen-title" {...stylex.props(styles.content)}>
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
            {members
              .filter((person) => person.status === 'pending')
              .map((person) => (
                <SurfaceCard key={person.membership_id} xstyle={[styles.card, styles.requestCard]}>
                  <h3 {...stylex.props(styles.cardTitle)}>{person.display_name}</h3>
                  <p {...stylex.props(styles.copy)}>
                    {t('communityAdmin.levelLabel', {
                      level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                        person.display_level
                      ),
                      reliability: new Intl.NumberFormat(locale).format(person.reliability_percent)
                    })}
                  </p>
                  <p {...stylex.props(styles.copy)}>
                    {t('communityAdmin.requestMeta', {
                      date: dateLabel(person.valid_from, locale),
                      privacy: t('communityAdmin.requestPrivacy')
                    })}
                  </p>
                  {actions(person)}
                </SurfaceCard>
              ))}
            {!members.some((person) => person.status === 'pending') && (
              <p>{t('communityAdmin.empty.requests')}</p>
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
              void search();
            }}
            {...stylex.props(styles.searchForm)}
          >
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
          </form>
          <div aria-label={t('communityAdmin.memberFilters')} {...stylex.props(styles.filterTabs)}>
            {(['active', 'pending', 'inactive'] as const).map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={memberFilter === status}
                onClick={() => {
                  setMemberFilter(status);
                  void search(status);
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
                      <h3 {...stylex.props(styles.cardTitle)}>{person.display_name}</h3>
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
            {!visibleMembers.length && <p>{t('communityAdmin.empty.members')}</p>}
          </div>
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
            {venues.map((venue) => (
              <SurfaceCard
                key={venue.id}
                data-testid="community-venue-card"
                xstyle={[styles.card, styles.venueCard]}
              >
                <h3 {...stylex.props(styles.cardTitle)}>{venue.name}</h3>
                <div {...stylex.props(styles.venueMeta)}>
                  <p {...stylex.props(styles.copy)}>
                    {venue.address || community.city_label || t('communityAdmin.cityUnavailable')}
                  </p>
                  {venue.maps_url && (
                    <a
                      href={venue.maps_url}
                      target="_blank"
                      rel="noreferrer"
                      {...stylex.props(styles.memberLink)}
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
            {!venues.length && <p>{t('communityAdmin.empty.venues')}</p>}
          </div>
          <p {...stylex.props(styles.note)}>{t('communityAdmin.venue.historyNote')}</p>
        </>
      )}
      {screen === 'audit' && (
        <div {...stylex.props(styles.list)}>
          <p {...stylex.props(styles.banner)}>{t('communityAdmin.audit.recentChanges')}</p>
          {auditRows.map((event) => (
            <SurfaceCard key={event.id} data-testid="community-audit-event" xstyle={styles.card}>
              <p {...stylex.props(styles.auditAction)}>
                {t(auditEventKey(event), { defaultValue: t('communityAdmin.audit.unknown') })}
              </p>
              <p {...stylex.props(styles.copy)}>
                {event.actor_user_id
                  ? t('communityAdmin.audit.actorAvailable')
                  : t('communityAdmin.audit.unknownActor')}{' '}
                · {dateLabel(event.occurred_at, locale)}
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
        <Button variant="secondary" onClick={() => void refresh()}>
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
