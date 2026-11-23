import { useUpdateGuard } from '../pwa/update-guard';
import { isOffline, isTransportFailure } from '../../lib/connectivity';
import * as stylex from '@stylexjs/stylex';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog } from '@base-ui/react/dialog';
import { Select } from '@base-ui/react/select';
import { Switch } from '@base-ui/react/switch';
import {
  Link,
  Outlet,
  useParams,
  useRouter,
  type ErrorComponentProps
} from '@tanstack/react-router';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { TextField } from '../../components/ui/TextField';
import { TopBar } from '../../components/ui/TopBar';
import {
  addCommunityVenue,
  archiveCommunityVenue,
  demoteCommunityMember,
  promoteCommunityMember,
  reactivateCommunityMember,
  removeCommunityMember,
  approveCommunityMember,
  denyCommunityMember,
  searchCommunityMembers,
  editCommunityVenue,
  listCommunityVenues,
  listCommunityAudit,
  updateCommunityAdminDefaults
} from './community-admin.functions';
import { communityDateLabel, dateLabel, failed, initials } from './community-admin.helpers';
import { updateCommunitySettings } from './community.functions';
import { sendCommunityRequestMessage } from './community-request.functions';
import { formatCommunityCurrencyPreview, type CommunityAdminDefaults } from './community-settings';
import type {
  CommunityAdminMember,
  CommunityAdminAudit,
  CommunityAdminScreenProps,
  CommunityAdminVenue
} from './community-admin.types';
import { unsupportedCommunityMatchSummary } from './community-admin.types';
import { styles } from './community-admin.styles';
import { VenuePhotoUpload } from './VenuePhotoUpload';
import { InviteeSearch } from './InviteeSearch';

// Set when the member sheet is opened from the mounted roster (history entry behind it). Kept in
// memory, not in history.state: history.state survives a document reload, which must fall back
// to the explicit Members route instead of popping an arbitrary entry.
let rosterOriginOpen = false;

type ScreenName = CommunityAdminScreenProps['screen'];
type ViewProps<Screen extends ScreenName> = Extract<CommunityAdminScreenProps, { screen: Screen }>;

type MemberCounts = Partial<
  Record<CommunityAdminMember['status'], { total: number; exact: boolean }>
>;

function MembersView({ community, members }: ViewProps<'members'>) {
  const matchSummary = unsupportedCommunityMatchSummary();
  const { t, i18n } = useTranslation();
  const params = useParams({ strict: false });
  const communityId = params.communityId ?? '';
  const [query, setQuery] = useState('');
  const [memberFilter, setMemberFilter] = useState<CommunityAdminMember['status']>('active');
  const [searchResults, setSearchResults] = useState<{
    source: CommunityAdminMember[];
    query: string;
    status: CommunityAdminMember['status'];
    rows: CommunityAdminMember[];
    hasMore: boolean;
  } | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasLoadedMoreMembers, setHasLoadedMoreMembers] = useState(false);
  // Counts come only from unfiltered result sets already read (exact when the list is complete,
  // a lower bound while more pages exist); a filter that was never opened has no count.
  const [knownCounts, setKnownCounts] = useState<MemberCounts>({});
  const searchRequest = useRef(0);
  const membersSourceRef = useRef(members);
  const hasSearchedMembers = useRef(false);
  const { busy, message, errorKey, setErrorKey } = useAdminMutationState();
  const locale = i18n.resolvedLanguage || i18n.language;
  const submittedQuery = query.trim();
  const currentSearch =
    searchResults?.source === members &&
    searchResults.query === submittedQuery &&
    searchResults.status === memberFilter
      ? searchResults
      : null;
  const initialActiveResults = submittedQuery === '' && memberFilter === 'active' && !searchResults;
  const visibleMembers = currentSearch?.rows ?? (initialActiveResults ? members : []);
  const canLoadMore = currentSearch?.hasMore ?? (initialActiveResults && members.length === 50);
  const searchingMembers =
    searchLoading ||
    (!initialActiveResults && !currentSearch && searchResults !== null) ||
    (submittedQuery !== '' && !currentSearch) ||
    (memberFilter !== 'active' && !currentSearch);

  const currentCount =
    submittedQuery === '' && !searchingMembers && (currentSearch || initialActiveResults)
      ? { total: visibleMembers.length, exact: !canLoadMore }
      : null;
  const counts: MemberCounts = currentCount
    ? { ...knownCounts, [memberFilter]: currentCount }
    : knownCounts;

  useEffect(() => {
    if (membersSourceRef.current === members) return;
    membersSourceRef.current = members;
    searchRequest.current += 1;
    setSearchResults(null);
    setSearchLoading(false);
    setHasLoadedMoreMembers(false);
    setKnownCounts({});
  }, [members]);

  const fetchMembers = useCallback(
    async (filterQuery: string, filterStatus: CommunityAdminMember['status'], offset = 0) => {
      const requestId = ++searchRequest.current;
      const source = members;
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
        if (requestId !== searchRequest.current || source !== membersSourceRef.current) return;
        setSearchResults((previous) => ({
          source,
          query: filterQuery,
          status: filterStatus,
          rows:
            offset > 0 &&
            previous?.source === source &&
            previous.query === filterQuery &&
            previous.status === filterStatus
              ? [...previous.rows, ...results]
              : results,
          hasMore: results.length === 50
        }));
      } catch (error) {
        if (requestId === searchRequest.current && source === membersSourceRef.current)
          setErrorKey(failed(error));
      } finally {
        if (requestId === searchRequest.current && source === membersSourceRef.current)
          setSearchLoading(false);
      }
    },
    [community.id, members, setErrorKey]
  );

  useEffect(() => {
    if (submittedQuery === '' && memberFilter === 'active' && !hasSearchedMembers.current)
      return undefined;
    const timer = setTimeout(() => void fetchMembers(submittedQuery, memberFilter), 250);
    return () => clearTimeout(timer);
  }, [fetchMembers, submittedQuery, memberFilter]);

  async function loadMoreMembers() {
    if (searchLoading || !canLoadMore) return;
    setHasLoadedMoreMembers(true);
    if (currentSearch) {
      await fetchMembers(currentSearch.query, currentSearch.status, currentSearch.rows.length);
      return;
    }
    setSearchResults({
      source: members,
      query: '',
      status: 'active',
      rows: members,
      hasMore: true
    });
    await fetchMembers('', 'active', members.length);
  }

  return (
    <AdminViewFrame communityId={communityId} communityName={community.name} screen="members">
      {community.visibility === 'private' && (
        <InviteeSearch key={communityId} communityId={communityId} />
      )}
      <form onSubmit={(event) => event.preventDefault()} {...stylex.props(styles.searchForm)}>
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
      <fieldset aria-label={t('communityAdmin.memberFilters')} {...stylex.props(styles.filterTabs)}>
        {(['active', 'pending', 'inactive'] as const).map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={memberFilter === status}
            onClick={() => {
              setKnownCounts(counts);
              setMemberFilter(status);
            }}
            {...stylex.props(styles.filterTab, memberFilter === status && styles.filterTabSelected)}
          >
            {memberFilter === status && <span aria-hidden="true">✓ </span>}
            {counts[status]
              ? t(
                  counts[status].exact
                    ? 'communityAdmin.filterCount'
                    : 'communityAdmin.filterCountAtLeast',
                  {
                    label: t(`communityAdmin.status.${status}`),
                    total: new Intl.NumberFormat(locale).format(counts[status].total)
                  }
                )
              : t(`communityAdmin.status.${status}`)}
          </button>
        ))}
      </fieldset>
      {searchingMembers && (
        <output aria-live="polite" {...stylex.props(styles.copy)}>
          {t('communityAdmin.searchLoading')}
        </output>
      )}
      {visibleMembers.length > 0 && (
        <div {...stylex.props(styles.listSurface)}>
          {visibleMembers.map((person) => (
            <SurfaceCard
              key={person.membership_id}
              data-testid="community-member-card"
              xstyle={[styles.card, styles.listRow]}
            >
              <span aria-hidden="true" {...stylex.props(styles.avatar)}>
                {initials(person.display_name)}
              </span>
              <div {...stylex.props(styles.memberDetails)}>
                <div {...stylex.props(styles.memberRowHeader)}>
                  <Link
                    to="/community/$communityId/admin/members/$membershipId"
                    params={{ communityId, membershipId: person.membership_id }}
                    onClick={(event) => {
                      if (
                        event.button === 0 &&
                        !event.metaKey &&
                        !event.ctrlKey &&
                        !event.shiftKey &&
                        !event.altKey
                      )
                        rosterOriginOpen = true;
                    }}
                    data-member-link={person.membership_id}
                    {...stylex.props(styles.memberLink)}
                  >
                    <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
                  </Link>
                  <span {...stylex.props(styles.roleBadge)}>
                    {t(`communityAdmin.role.${person.role}`)}
                  </span>
                </div>
                <p {...stylex.props(styles.copy)}>
                  {t('communityAdmin.memberJoined', { date: dateLabel(person.valid_from, locale) })}
                </p>
                <p {...stylex.props(styles.copy)}>{ratingLabel(person, t, locale)}</p>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
      {!visibleMembers.length && !searchingMembers && (
        <p {...stylex.props(styles.copy, styles.emptyState)}>{t('communityAdmin.empty.members')}</p>
      )}
      {matchSummary.status === 'unsupported' && (
        <p {...stylex.props(styles.note)}>{t('communityAdmin.matchCountUnavailable')}</p>
      )}
      {canLoadMore ? (
        <Button
          variant="secondary"
          busy={searchLoading || busy}
          onClick={() => void loadMoreMembers()}
        >
          {t('communityAdmin.loadMore')}
        </Button>
      ) : (
        hasLoadedMoreMembers && (
          <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
        )
      )}
      <p {...stylex.props(styles.note)}>{t('communityAdmin.levelReadOnly')}</p>
      {message && <output {...stylex.props(styles.status)}>{message}</output>}
      {errorKey && (
        <p role="alert" {...stylex.props(styles.error)}>
          {t(`communityAdmin.error.${errorKey}`)}
        </p>
      )}
      {errorKey && (
        <Button variant="secondary" onClick={() => void fetchMembers(submittedQuery, memberFilter)}>
          {t('communityAdmin.retry')}
        </Button>
      )}
      <Outlet />
    </AdminViewFrame>
  );
}

function RequestsView(props: ViewProps<'requests'>) {
  const { community, members, timezone, datasetGeneration } = props;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useParams({ strict: false });
  const communityId = params.communityId ?? '';
  const [pageState, setPageState] = useState({
    generation: datasetGeneration,
    rows: [] as CommunityAdminMember[],
    hasLoaded: false,
    hasMore: members.length === 50
  });
  const [pageLoading, setPageLoading] = useState(false);
  const pageOwner = useRef({ generation: datasetGeneration, requestId: 0, mounted: true });
  const additionalRequests = pageState.generation === datasetGeneration ? pageState.rows : [];
  const hasLoadedMoreRequests = pageState.generation === datasetGeneration && pageState.hasLoaded;
  const hasMoreRequests =
    pageState.generation === datasetGeneration ? pageState.hasMore : members.length === 50;
  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
  const locale = i18n.resolvedLanguage || i18n.language;

  useLayoutEffect(() => {
    if (pageOwner.current.generation === datasetGeneration) return;
    pageOwner.current = {
      ...pageOwner.current,
      generation: datasetGeneration,
      requestId: pageOwner.current.requestId + 1
    };
    setPageLoading(false);
    setPageState({
      generation: datasetGeneration,
      rows: [],
      hasLoaded: false,
      hasMore: members.length === 50
    });
  }, [datasetGeneration, members.length]);
  useEffect(() => {
    pageOwner.current.mounted = true;
    return () => {
      pageOwner.current.mounted = false;
      pageOwner.current.requestId += 1;
    };
  }, []);

  async function loadMoreRequests() {
    if (busy || pageLoading || !hasMoreRequests) return;
    const token = datasetGeneration;
    const requestId = ++pageOwner.current.requestId;
    const ownsRequest = () =>
      pageOwner.current.mounted &&
      pageOwner.current.generation === token &&
      pageOwner.current.requestId === requestId;
    setPageLoading(true);
    setPageState((previous) =>
      previous.generation === token ? { ...previous, hasLoaded: true } : previous
    );
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
      if (!ownsRequest()) return;
      setPageState((previous) =>
        previous.generation === token && ownsRequest()
          ? { ...previous, rows: [...previous.rows, ...page], hasMore: page.length === 50 }
          : previous
      );
    } catch (error) {
      if (ownsRequest()) setErrorKey(failed(error));
    } finally {
      if (ownsRequest()) setPageLoading(false);
    }
  }

  async function memberAction(person: CommunityAdminMember, action: 'approve' | 'deny') {
    if (busy || pageLoading) return;
    if (!navigator.onLine) {
      setErrorKey('offline');
      return;
    }
    setBusy(true);
    setErrorKey('');
    setMessage('');
    try {
      await (action === 'approve' ? approveCommunityMember : denyCommunityMember)({
        data: { community_id: community.id, membership_id: person.membership_id }
      });
      pageOwner.current.requestId += 1;
      setPageLoading(false);
      setPageState({
        generation: datasetGeneration,
        rows: [],
        hasLoaded: false,
        hasMore: members.length === 50
      });
      setMessage(t(`communityAdmin.result.${action}`));
      await router.invalidate();
    } catch (error) {
      setErrorKey(failed(error) === 'generic' ? 'unconfirmed' : failed(error));
    } finally {
      setBusy(false);
    }
  }

  const waiting = members.length + additionalRequests.length;
  const waitingLabel = t(
    hasMoreRequests ? 'communityAdmin.requestsWaitingAtLeast' : 'communityAdmin.requestsWaiting',
    { community: community.name, count: waiting }
  );

  return (
    <AdminViewFrame
      communityId={communityId}
      communityName={community.name}
      screen="requests"
      subtitle={waitingLabel}
    >
      <p {...stylex.props(styles.banner)}>{t('communityAdmin.requestBanner')}</p>
      <div {...stylex.props(styles.list)}>
        {[...members, ...additionalRequests].map((person) => (
          <SurfaceCard
            key={person.membership_id}
            data-testid="community-request-card"
            xstyle={[styles.card, styles.requestCard]}
          >
            <div {...stylex.props(styles.requestHeader)}>
              <span aria-hidden="true" {...stylex.props(styles.avatar, styles.avatarLarge)}>
                {initials(person.display_name)}
              </span>
              <div {...stylex.props(styles.requestIdentity)}>
                <h3 {...stylex.props(styles.cardCompactTitle)}>{person.display_name}</h3>
                <p {...stylex.props(styles.copy)}>{ratingLabel(person, t, locale)}</p>
              </div>
              <RequestMessageComposer
                communityId={community.id}
                membershipId={person.membership_id}
                t={t}
              />
            </div>
            <div {...stylex.props(styles.actions, styles.requestActions)}>
              <Button
                variant="secondary"
                busy={busy || pageLoading}
                onClick={() => void memberAction(person, 'deny')}
              >
                {t('communityAdmin.action.deny')}
              </Button>
              <Button
                busy={busy || pageLoading}
                onClick={() => void memberAction(person, 'approve')}
              >
                {t('communityAdmin.action.approve')}
              </Button>
            </div>
            <p {...stylex.props(styles.copy, styles.requestMeta)}>
              {t('communityAdmin.requestMeta', {
                date: communityDateLabel(person.valid_from, locale, timezone),
                privacy: t('communityAdmin.requestPrivacy')
              })}
            </p>
          </SurfaceCard>
        ))}
        {!members.length && !additionalRequests.length && (
          <p {...stylex.props(styles.copy, styles.emptyState)}>
            {t('communityAdmin.empty.requests')}
          </p>
        )}
        {hasMoreRequests ? (
          <Button
            variant="secondary"
            busy={busy || pageLoading}
            onClick={() => void loadMoreRequests()}
          >
            {t('communityAdmin.loadMore')}
          </Button>
        ) : (
          hasLoadedMoreRequests && (
            <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
          )
        )}
        <p {...stylex.props(styles.note)}>{t('communityAdmin.requestHistoryUnavailable')}</p>
      </div>
      {message && <output {...stylex.props(styles.status)}>{message}</output>}
      {errorKey && (
        <p role="alert" {...stylex.props(styles.error)}>
          {t(`communityAdmin.error.${errorKey}`)}
        </p>
      )}
    </AdminViewFrame>
  );
}

function useAdminMutationState() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errorKey, setErrorKey] = useState('');
  useUpdateGuard(busy || errorKey === 'unconfirmed');
  return { busy, setBusy, message, setMessage, errorKey, setErrorKey };
}

function ratingLabel(
  person: CommunityAdminMember,
  t: ReturnType<typeof useTranslation>['t'],
  locale: string
) {
  if (person.display_level === null || person.reliability_percent === null)
    return t('communityAdmin.ratingsUnavailable');
  return t('communityAdmin.levelLabel', {
    level: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(person.display_level),
    reliability: new Intl.NumberFormat(locale).format(person.reliability_percent)
  });
}

function AdminViewFrame({
  communityId,
  communityName,
  screen,
  subtitle,
  children
}: {
  communityId: string;
  communityName: string;
  screen: 'requests' | 'members' | 'settings' | 'venues' | 'audit';
  /** Replaces the default "community · Admin only" line (e.g. with the real waiting count). */
  subtitle?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const items = [
    { key: 'requests', to: '/community/$communityId/admin/requests' },
    { key: 'members', to: '/community/$communityId/admin/members' },
    { key: 'settings', to: '/community/$communityId/admin/settings' },
    { key: 'venues', to: '/community/$communityId/admin/venues' },
    { key: 'audit', to: '/community/$communityId/admin/audit' }
  ] as const;
  return (
    <section
      aria-labelledby="admin-screen-title"
      data-route-chrome="navigation"
      {...stylex.props(styles.content)}
    >
      <TopBar
        xstyle={styles.topBar}
        headingId="admin-screen-title"
        title={t(`communityAdmin.title.${screen}`)}
        back={{ to: '/dashboard', label: t('communityAdmin.backToDashboard') }}
      />
      <p {...stylex.props(styles.subtitle)}>
        {subtitle ?? t('communityAdmin.communityAdminSubtitle', { community: communityName })}
      </p>
      {children}
      <nav aria-label={t('communityAdmin.navigation')} {...stylex.props(styles.bottomNav)}>
        {items.map((item) => (
          <Link
            key={item.key}
            to={item.to}
            params={{ communityId }}
            aria-current={item.key === screen ? 'page' : undefined}
            {...stylex.props(styles.bottomNavLink)}
          >
            {t(`communityAdmin.nav.${item.key}`)}
          </Link>
        ))}
      </nav>
    </section>
  );
}

type MemberActionName = 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote';

const membersPath = '/community/$communityId/admin/members';

// Row glyphs follow the jQDkx frame's text glyphs; they are decorative (aria-hidden).
const actionGlyphs: Record<MemberActionName, string> = {
  approve: '✓',
  deny: '✕',
  reactivate: '↺',
  promote: '★',
  demote: '☆',
  remove: '✕'
};

function memberSheetActions(member: CommunityAdminMember): MemberActionName[] {
  if (member.status === 'pending') return ['approve', 'deny'];
  if (member.status === 'inactive') return ['reactivate'];
  return [member.role === 'admin' ? 'demote' : 'promote', 'remove'];
}

function MemberSheetFrame({
  title,
  description,
  busy = false,
  membershipId,
  titleRef,
  popupRef,
  children
}: {
  title: string;
  description?: ReactNode;
  busy?: boolean;
  membershipId: string;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  popupRef: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams({ strict: false });
  const communityId = params.communityId ?? '';
  const closing = useRef(false);
  const fromRoster = useRef(rosterOriginOpen);
  const originId = useRef(membershipId);
  useEffect(() => {
    originId.current = membershipId;
  }, [membershipId]);

  // The sheet is derived from the route. Closing from a roster visit pops that history entry
  // (the mounted roster keeps its filter, rows and scroll); a deep link or reload has no roster
  // entry behind it, so closing replaces the route with the Members screen instead of leaving.
  function closeSheet() {
    if (closing.current) return;
    closing.current = true;
    if (fromRoster.current) {
      router.history.back();
      return;
    }
    void router.navigate({ to: membersPath, params: { communityId }, replace: true }).catch(() => {
      closing.current = false;
    });
  }

  // Every exit path (close, Escape, backdrop, browser Back) unmounts the sheet: return focus to
  // the originating roster row; a deep link or reload has no origin row and lands on the Members
  // heading (as does a roster origin whose row is no longer on screen).
  useEffect(
    () => () => {
      rosterOriginOpen = false;
      // The modal layer releases its inert/focus handling after this cleanup; retry for a few
      // frames until the target accepts focus.
      let attempts = 0;
      const restore = () => {
        const row = fromRoster.current
          ? Array.from(document.querySelectorAll<HTMLElement>('[data-member-link]')).find(
              (element) => element.dataset.memberLink === originId.current
            )
          : undefined;
        const target = row ?? document.getElementById('admin-screen-title');
        target?.focus();
        if (target && document.activeElement !== target && attempts++ < 10)
          window.requestAnimationFrame(restore);
      };
      window.setTimeout(restore, 0);
    },
    []
  );

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) closeSheet();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.confirmBackdrop)} />
        <Dialog.Viewport {...stylex.props(styles.sheetViewport)}>
          <Dialog.Popup
            ref={popupRef}
            data-testid="community-member-sheet"
            initialFocus={titleRef}
            finalFocus={false}
            {...stylex.props(styles.sheetPopup)}
          >
            <div aria-hidden="true" {...stylex.props(styles.sheetGrabber)}>
              <span {...stylex.props(styles.sheetGrab)} />
            </div>
            <div {...stylex.props(styles.sheetHead)}>
              <Dialog.Title ref={titleRef} tabIndex={-1} {...stylex.props(styles.sheetTitle)}>
                {title}
              </Dialog.Title>
              {description}
            </div>
            {children}
            <Dialog.Close {...stylex.props(styles.sheetClose)}>
              {t('communityAdmin.sheetClose')}
            </Dialog.Close>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MemberSheetRow({
  glyph,
  title,
  hint,
  destructive = false,
  busy = false,
  rowRef,
  onClick
}: {
  glyph: string;
  title: string;
  hint?: string;
  destructive?: boolean;
  busy?: boolean;
  rowRef?: React.Ref<HTMLButtonElement>;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const titleId = useId();
  const hintId = useId();
  return (
    <button
      ref={rowRef}
      type="button"
      data-sheet-row=""
      aria-labelledby={titleId}
      aria-describedby={hint === undefined ? undefined : hintId}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (!busy) onClick(event);
      }}
      {...stylex.props(styles.sheetRow, hint !== undefined && styles.sheetRowDescribed)}
    >
      <span aria-hidden="true" {...stylex.props(styles.sheetGlyph)}>
        {glyph}
      </span>
      <span {...stylex.props(styles.sheetRowText)}>
        <span
          id={titleId}
          {...stylex.props(styles.sheetRowTitle, destructive && styles.sheetRowTitleDanger)}
        >
          {title}
        </span>
        {hint !== undefined && (
          <span id={hintId} {...stylex.props(styles.sheetRowHint)}>
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

export function CommunityAdminMemberError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams({ strict: false });
  const titleRef = useRef<HTMLHeadingElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const denied = error instanceof Error && error.message === 'NOT_COMMUNITY_ADMIN';
  const missing = error instanceof Error && error.message === 'COMMUNITY_MEMBER_NOT_FOUND';
  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      await router.invalidate();
      reset();
    } catch {
      // Keep the error visible when the refresh fails.
    } finally {
      setBusy(false);
    }
  }
  return (
    <MemberSheetFrame
      title={t(
        denied
          ? 'communityAdmin.accessDeniedTitle'
          : missing
            ? 'communityAdmin.title.member'
            : 'communityAdmin.errorTitle'
      )}
      busy={busy}
      membershipId={params.membershipId ?? ''}
      titleRef={titleRef}
      popupRef={popupRef}
      description={
        <Dialog.Description role="alert" {...stylex.props(styles.sheetMeta)}>
          {t(
            denied
              ? 'communityAdmin.accessDenied'
              : missing
                ? 'communityAdmin.empty.member'
                : 'communityAdmin.error.generic'
          )}
        </Dialog.Description>
      }
    >
      {!denied && !missing && (
        <MemberSheetRow
          glyph="↺"
          title={t('communityAdmin.retry')}
          busy={busy}
          onClick={() => void retry()}
        />
      )}
    </MemberSheetFrame>
  );
}

function MemberView(props: ViewProps<'member'>) {
  const { community, member, membershipId } = props;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
  const [confirmation, setConfirmation] = useState<'demote' | 'remove' | null>(null);
  const [completedConfirmation, setCompletedConfirmation] = useState<{
    action: 'demote' | 'remove';
    membershipId: string;
  } | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const locale = i18n.resolvedLanguage || i18n.language;

  // A refresh can remove the action row that held focus (role change, completed removal): move
  // focus to the sheet heading instead of letting it fall to the document.
  const actionKey = `${membershipId}:${member.status}:${member.role}:${String(completedConfirmation?.action)}`;
  const seenActionKey = useRef(actionKey);
  useEffect(() => {
    if (seenActionKey.current === actionKey || confirmation) return;
    seenActionKey.current = actionKey;
    const active = document.activeElement;
    if (popupRef.current && (!active || active === document.body)) titleRef.current?.focus();
  });

  async function memberAction(action: MemberActionName): Promise<boolean> {
    if (busy) return false;
    if (!navigator.onLine) {
      setErrorKey('offline');
      return false;
    }
    setBusy(true);
    setErrorKey('');
    setRefreshError(false);
    setMessage('');
    const actions = {
      approve: approveCommunityMember,
      deny: denyCommunityMember,
      remove: removeCommunityMember,
      reactivate: reactivateCommunityMember,
      promote: promoteCommunityMember,
      demote: demoteCommunityMember
    };
    let result: unknown;
    try {
      result = await actions[action]({
        data: { community_id: community.id, membership_id: membershipId }
      });
    } catch (error) {
      setErrorKey(failed(error) === 'generic' ? 'unconfirmed' : failed(error));
      setBusy(false);
      return false;
    }

    setMessage(t(`communityAdmin.result.${action}`));
    try {
      await router.invalidate();
      if (
        action === 'reactivate' &&
        typeof result === 'object' &&
        result !== null &&
        'membership_id' in result &&
        typeof result.membership_id === 'string'
      ) {
        await router.navigate({
          to: '/community/$communityId/admin/members/$membershipId',
          params: { communityId: community.id, membershipId: result.membership_id },
          replace: true
        });
      }
    } catch {
      setErrorKey('generic');
      setRefreshError(true);
    }
    setBusy(false);
    return true;
  }

  function requestMemberAction(action: MemberActionName, trigger?: HTMLButtonElement) {
    if (action === 'remove' || action === 'demote') {
      if (trigger) triggerRef.current = trigger;
      setConfirmation(action);
    } else {
      void memberAction(action).then((succeeded) => {
        if (succeeded) setCompletedConfirmation(null);
      });
    }
  }

  async function confirmMemberAction() {
    if (!confirmation || busy) return;
    if (await memberAction(confirmation)) {
      setCompletedConfirmation({ action: confirmation, membershipId });
      setConfirmation(null);
    }
  }

  async function retryRefresh() {
    if (busy) return;
    setBusy(true);
    try {
      await router.invalidate();
      setErrorKey('');
      setRefreshError(false);
    } catch {
      setErrorKey('generic');
      setRefreshError(true);
    } finally {
      setBusy(false);
    }
  }

  const completed = (action: 'demote' | 'remove') =>
    completedConfirmation?.membershipId === membershipId && completedConfirmation.action === action;
  const actions = memberSheetActions(member).filter(
    (action) => !((action === 'demote' || action === 'remove') && completed(action))
  );

  return (
    <MemberSheetFrame
      title={member.display_name}
      busy={busy}
      membershipId={membershipId}
      titleRef={titleRef}
      popupRef={popupRef}
      description={
        <Dialog.Description render={<div />}>
          <p {...stylex.props(styles.sheetMeta)}>
            {t('communityAdmin.memberMeta', {
              status: t(`communityAdmin.status.${member.status}`),
              role: t(`communityAdmin.role.${member.role}`),
              date: dateLabel(member.valid_from, locale)
            })}
          </p>
          <p {...stylex.props(styles.sheetMeta)}>{ratingLabel(member, t, locale)}</p>
        </Dialog.Description>
      }
    >
      {member.status === 'active' && (
        <Link
          to="/players/$playerId"
          params={{ playerId: member.user_id }}
          data-sheet-row=""
          {...stylex.props(styles.sheetRow)}
        >
          <span aria-hidden="true" {...stylex.props(styles.sheetGlyph)}>
            ↗
          </span>
          <span {...stylex.props(styles.sheetRowText)}>
            <span {...stylex.props(styles.sheetRowTitle)}>{t('communityAdmin.viewProfile')}</span>
          </span>
        </Link>
      )}
      {actions.map((action) => (
        <MemberSheetRow
          key={action}
          glyph={actionGlyphs[action]}
          title={t(`communityAdmin.action.${action}`)}
          hint={t(`communityAdmin.actionHint.${action}`)}
          destructive={action === 'remove'}
          busy={busy}
          onClick={(event) => requestMemberAction(action, event.currentTarget)}
        />
      ))}
      <AlertDialog.Root
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop {...stylex.props(styles.confirmBackdrop)} />
          <AlertDialog.Viewport {...stylex.props(styles.confirmViewport)}>
            <AlertDialog.Popup
              initialFocus={() => cancelRef.current}
              finalFocus={() =>
                triggerRef.current?.isConnected ? triggerRef.current : titleRef.current
              }
              onKeyDown={(event) => {
                if (event.key !== 'Tab') return;
                const controls = event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
                );
                const first = controls.item(0);
                const last = controls.item(controls.length - 1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }}
              {...stylex.props(styles.confirmDialog)}
            >
              <AlertDialog.Title {...stylex.props(styles.confirmTitle)}>
                {t('communityAdmin.confirm', {
                  action: confirmation ? t(`communityAdmin.action.${confirmation}`) : '',
                  name: member.display_name
                })}
              </AlertDialog.Title>
              <div {...stylex.props(styles.actions)}>
                <Button busy={busy} onClick={() => void confirmMemberAction()}>
                  {t('communityAdmin.confirmAction')}
                </Button>
                {confirmation && errorKey && !refreshError && (
                  <>
                    <p role="alert" {...stylex.props(styles.error)}>
                      {t(`communityAdmin.error.${errorKey}`)}
                    </p>
                    <Button
                      variant="secondary"
                      busy={busy}
                      onClick={() => void confirmMemberAction()}
                    >
                      {t('communityAdmin.retry')}
                    </Button>
                  </>
                )}
                <AlertDialog.Close
                  render={
                    <Button
                      ref={(node) => {
                        cancelRef.current = node;
                        if (node && confirmation) node.focus();
                      }}
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setConfirmation(null)}
                    />
                  }
                >
                  {t('communityAdmin.cancel')}
                </AlertDialog.Close>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <p {...stylex.props(styles.sheetMeta)}>{t('communityAdmin.sheetAudited')}</p>
      {message && <output {...stylex.props(styles.status)}>{message}</output>}
      {errorKey && (!confirmation || refreshError) && (
        <p role="alert" {...stylex.props(styles.error)}>
          {t(`communityAdmin.error.${errorKey}`)}
        </p>
      )}
      {errorKey && (!confirmation || refreshError) && (
        <MemberSheetRow
          glyph="↺"
          title={t('communityAdmin.retry')}
          busy={busy}
          onClick={() => void retryRefresh()}
        />
      )}
    </MemberSheetFrame>
  );
}

function SettingsView(props: ViewProps<'settings'>) {
  const { community, defaults } = props;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useParams({ strict: false });
  const communityId = params.communityId ?? '';
  const [settings, setSettings] = useState({
    name: community.name,
    description: community.description ?? '',
    city_label: community.city_label ?? '',
    visibility: community.visibility,
    join_policy: community.join_policy
  });
  const [adminDefaults, setAdminDefaults] = useState<CommunityAdminDefaults>(defaults);
  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setMessage('');
    if (isOffline()) {
      setErrorKey('offline');
      return;
    }
    setBusy(true);
    setErrorKey('');
    try {
      await updateCommunitySettings({ data: { community_id: community.id, ...settings } });
      await updateCommunityAdminDefaults({
        data: { community_id: community.id, defaults: adminDefaults }
      });
      setSettings({ ...settings });
      setMessage(t('communityAdmin.result.settings'));
      try {
        await router.invalidate();
      } catch {
        setErrorKey('generic');
      }
    } catch (error) {
      setErrorKey(failed(error) === 'generic' ? 'unconfirmed' : failed(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminViewFrame communityId={communityId} communityName={community.name} screen="settings">
      <form
        onSubmit={(event) => void saveSettings(event)}
        {...stylex.props(styles.form, styles.settingsForm)}
      >
        <TextField
          id="community-admin-name"
          label={t('communityAdmin.settings.name')}
          value={settings.name}
          maxLength={80}
          onChange={(event) => setSettings({ ...settings, name: event.target.value })}
          required
        />
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
        <SurfaceCard xstyle={styles.settingsDefaultsCard}>
          <div {...stylex.props(styles.settingsTimezoneRow)}>
            <label {...stylex.props(styles.fieldLabel)}>
              {t('communityAdmin.settings.timezone')}
            </label>
            <Select.Root
              inputRef={(input) => {
                if (input) input.style.display = 'none';
              }}
              value={adminDefaults.timezone}
              onValueChange={(timezone) => {
                if (timezone === 'Europe/Madrid' || timezone === 'UTC')
                  setAdminDefaults({ ...adminDefaults, timezone });
              }}
            >
              <Select.Trigger
                aria-label={t('communityAdmin.settings.timezone')}
                data-testid="settings-timezone-control"
                {...stylex.props(styles.settingChoice, styles.settingsTimezoneSelect)}
              >
                <Select.Value />
                <Select.Icon aria-hidden="true">⌄</Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Positioner>
                  <Select.Popup {...stylex.props(styles.settingsTimezonePopup)}>
                    <Select.Item
                      value="Europe/Madrid"
                      {...stylex.props(
                        styles.settingsTimezoneItem,
                        adminDefaults.timezone === 'Europe/Madrid' && styles.settingTimezoneSelected
                      )}
                    >
                      <Select.ItemText>
                        {t('communityAdmin.settings.timezoneMadrid')}
                      </Select.ItemText>
                    </Select.Item>
                    <Select.Item
                      value="UTC"
                      {...stylex.props(
                        styles.settingsTimezoneItem,
                        adminDefaults.timezone === 'UTC' && styles.settingTimezoneSelected
                      )}
                    >
                      <Select.ItemText>{t('communityAdmin.settings.timezoneUtc')}</Select.ItemText>
                    </Select.Item>
                  </Select.Popup>
                </Select.Positioner>
              </Select.Portal>
            </Select.Root>
          </div>
          <p data-testid="settings-currency-control" {...stylex.props(styles.settingsCurrencyRow)}>
            {t('communityAdmin.settings.currencyEur')} ·{' '}
            {t('communityAdmin.settings.currencyPreview')}:{' '}
            {formatCommunityCurrencyPreview(
              i18n.resolvedLanguage || i18n.language,
              adminDefaults.currency
            )}
          </p>
          <div {...stylex.props(styles.settingsLeagueRow)}>
            <div {...stylex.props(styles.settingsLeagueCopy)}>
              <label {...stylex.props(styles.fieldLabel)}>
                {t('communityAdmin.settings.memberCreatedLeagues')}
              </label>
              <span {...stylex.props(styles.settingsLeagueNote)}>
                {t('communityAdmin.settings.leaguePreferenceOnly')}
              </span>
            </div>
            <Switch.Root
              nativeButton
              inputRef={(input) => {
                if (input) input.style.display = 'none';
              }}
              {...stylex.props(
                styles.settingsSwitch,
                adminDefaults.member_created_leagues_enabled && styles.settingsSwitchChecked
              )}
              checked={adminDefaults.member_created_leagues_enabled}
              onCheckedChange={(checked) =>
                setAdminDefaults({ ...adminDefaults, member_created_leagues_enabled: checked })
              }
              aria-label={t('communityAdmin.settings.memberCreatedLeagues')}
            >
              <Switch.Thumb
                {...stylex.props(
                  styles.settingsSwitchThumb,
                  adminDefaults.member_created_leagues_enabled && styles.settingsSwitchThumbChecked
                )}
              />
            </Switch.Root>
          </div>
        </SurfaceCard>
        <Button type="submit" busy={busy} xstyle={styles.settingsSaveControl}>
          {t('communityAdmin.save')}
        </Button>
        <details {...stylex.props(styles.details)}>
          <summary {...stylex.props(styles.detailsSummary)}>
            <span>{t('communityAdmin.settings.details')}</span>
            <span {...stylex.props(styles.settingsFooterNote)}>
              {t('communityAdmin.settingsAdminNote')}
            </span>
          </summary>
          <div {...stylex.props(styles.form)}>
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
              onChange={(event) => setSettings({ ...settings, description: event.target.value })}
            />
            <select
              id="community-visibility-details"
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
              id="community-join-policy-details"
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
          </div>
        </details>
      </form>
      {message && (
        <output {...stylex.props(styles.status)}>
          <span>{message}</span>
          <span>{t('communityAdmin.settings.defaultsSaved')}</span>
        </output>
      )}
      {errorKey && (
        <p role="alert" {...stylex.props(styles.error)}>
          {t(`communityAdmin.error.${errorKey}`)}
        </p>
      )}
      {errorKey && (
        <Button variant="secondary" onClick={() => void router.invalidate()}>
          {t('communityAdmin.retry')}
        </Button>
      )}
    </AdminViewFrame>
  );
}

function VenuesView({ community, venues }: ViewProps<'venues'>) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams({ strict: false });
  const communityId = params.communityId ?? '';
  const [additionalVenues, setAdditionalVenues] = useState<CommunityAdminVenue[]>([]);
  const [hasLoadedMoreVenues, setHasLoadedMoreVenues] = useState(false);
  const [hasMoreVenues, setHasMoreVenues] = useState(venues.length === 50);
  const [venueDraft, setVenueDraft] = useState({ id: '', name: '', address: '', maps_url: '' });
  const [paginationPending, setPaginationPending] = useState(false);
  const sourceRef = useRef(venues);
  const requestGeneration = useRef(0);
  const { busy, setBusy, message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
  const resetDraft = () => setVenueDraft({ id: '', name: '', address: '', maps_url: '' });

  useEffect(() => {
    if (sourceRef.current === venues) return;
    sourceRef.current = venues;
    requestGeneration.current += 1;
    setPaginationPending(false);
    setAdditionalVenues([]);
    setHasLoadedMoreVenues(false);
    setHasMoreVenues(venues.length === 50);
  }, [venues]);

  async function run(action: () => Promise<unknown>, success: string) {
    if (busy || paginationPending) return false;
    setMessage('');
    if (isOffline()) {
      setErrorKey('offline');
      return false;
    }
    setBusy(true);
    setErrorKey('');
    try {
      await action();
      setAdditionalVenues([]);
      setHasLoadedMoreVenues(false);
      setHasMoreVenues(venues.length === 50);
      setMessage(success);
      try {
        await router.invalidate();
      } catch {
        setErrorKey('generic');
      }
      return true;
    } catch (error) {
      setErrorKey(failed(error) === 'generic' ? 'unconfirmed' : failed(error));
      return false;
    } finally {
      setBusy(false);
    }
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
    if (saved) resetDraft();
  }

  async function loadMoreVenues() {
    if (busy || paginationPending || !hasMoreVenues) return;
    setPaginationPending(true);
    setHasLoadedMoreVenues(true);
    const source = venues;
    const generation = ++requestGeneration.current;
    try {
      const page = await listCommunityVenues({
        data: {
          community_id: community.id,
          offset: venues.length + additionalVenues.length,
          limit: 50
        }
      });
      if (sourceRef.current !== source || requestGeneration.current !== generation) return;
      setAdditionalVenues((previous) => [...previous, ...page]);
      setHasMoreVenues(page.length === 50);
    } catch (error) {
      if (sourceRef.current === source && requestGeneration.current === generation)
        setErrorKey(failed(error));
    } finally {
      if (requestGeneration.current === generation) setPaginationPending(false);
    }
  }

  const venueRows = [...venues, ...additionalVenues];
  const editing = venueDraft.id !== '';
  return (
    <AdminViewFrame communityId={communityId} communityName={community.name} screen="venues">
      {venueRows.length > 0 ? (
        <ul {...stylex.props(styles.listSurface, styles.plainList)}>
          {venueRows.map((venue) => (
            <li
              key={venue.id}
              data-testid="community-venue-card"
              {...stylex.props(styles.venueRow)}
            >
              <div {...stylex.props(styles.venueHead)}>
                {venue.photo_signed_url ? (
                  <img src={venue.photo_signed_url} alt="" {...stylex.props(styles.venuePhoto)} />
                ) : (
                  <span aria-hidden="true" {...stylex.props(styles.venuePhoto)} />
                )}
                <div {...stylex.props(styles.memberDetails)}>
                  <h3 {...stylex.props(styles.cardCompactTitle)}>{venue.name}</h3>
                  <p {...stylex.props(styles.copy)}>
                    {venue.address || community.city_label || t('communityAdmin.cityUnavailable')}
                  </p>
                </div>
              </div>
              <div {...stylex.props(styles.venueActions)}>
                {venue.maps_url && (
                  <a
                    href={venue.maps_url}
                    target="_blank"
                    rel="noreferrer"
                    {...stylex.props(styles.memberLink, styles.inlineLink, styles.venueAction)}
                  >
                    {t('communityAdmin.venue.openMap')}
                  </a>
                )}
                <Button
                  variant="secondary"
                  busy={busy || paginationPending}
                  onClick={() => {
                    setVenueDraft({
                      id: venue.id,
                      name: venue.name,
                      address: venue.address ?? '',
                      maps_url: venue.maps_url ?? ''
                    });
                  }}
                >
                  {t('communityAdmin.venue.edit')}
                </Button>
                <Button
                  variant="secondary"
                  busy={busy || paginationPending}
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
            </li>
          ))}
        </ul>
      ) : (
        <p {...stylex.props(styles.copy, styles.emptyState)}>{t('communityAdmin.empty.venues')}</p>
      )}
      <SurfaceCard xstyle={styles.card}>
        <h3 {...stylex.props(styles.cardTitle)}>
          {t(editing ? 'communityAdmin.venue.edit' : 'communityAdmin.venue.add')}
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
            onChange={(event) => setVenueDraft({ ...venueDraft, address: event.target.value })}
          />
          <TextField
            id="venue-map"
            label={t('communityAdmin.venue.mapsUrl')}
            value={venueDraft.maps_url}
            maxLength={2048}
            type="url"
            onChange={(event) => setVenueDraft({ ...venueDraft, maps_url: event.target.value })}
          />
          {editing && (
            <VenuePhotoUpload
              key={venueDraft.id}
              communityId={community.id}
              venueId={venueDraft.id}
              photoUrl={
                venueRows.find((venue) => venue.id === venueDraft.id)?.photo_signed_url ?? null
              }
              onUploaded={() => void router.invalidate()}
            />
          )}
          <Button type="submit" busy={busy || paginationPending}>
            {t('communityAdmin.save')}
          </Button>
        </form>
        {editing && (
          <Button variant="secondary" onClick={resetDraft}>
            {t('communityAdmin.cancel')}
          </Button>
        )}
      </SurfaceCard>
      {hasMoreVenues ? (
        <Button
          variant="secondary"
          busy={busy || paginationPending}
          onClick={() => void loadMoreVenues()}
        >
          {t('communityAdmin.loadMore')}
        </Button>
      ) : (
        hasLoadedMoreVenues && <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
      )}
      <p {...stylex.props(styles.note)}>{t('communityAdmin.venue.historyNote')}</p>
      {message && <output {...stylex.props(styles.status)}>{message}</output>}
      {errorKey && (
        <p role="alert" {...stylex.props(styles.error)}>
          {t(`communityAdmin.error.${errorKey}`)}
        </p>
      )}
      {errorKey && (
        <Button variant="secondary" onClick={() => void router.invalidate()}>
          {t('communityAdmin.retry')}
        </Button>
      )}
    </AdminViewFrame>
  );
}

function RequestMessageComposer({
  communityId,
  membershipId,
  t
}: {
  communityId: string;
  membershipId: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<
    'empty' | 'failed' | 'notPending' | 'offline' | 'rateLimited' | 'unconfirmed' | null
  >(null);
  const [sent, setSent] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const lastPayload = useRef('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!body.trim()) {
      setError('empty');
      return;
    }
    if (isOffline()) {
      setError('offline');
      return;
    }
    const payload = body.trim();
    if (lastPayload.current !== payload) {
      lastPayload.current = payload;
      requestId.current = crypto.randomUUID();
    }
    setBusy(true);
    try {
      await sendCommunityRequestMessage({
        data: {
          community_id: communityId,
          membership_id: membershipId,
          body: payload,
          client_request_id: requestId.current
        }
      });
      setSent(true);
      setOpen(false);
      setBody('');
      lastPayload.current = '';
      requestId.current = crypto.randomUUID();
    } catch (failure) {
      const notPending = failure instanceof Error && failure.message === 'REQUEST_NOT_PENDING';
      const rateLimited =
        failure instanceof Error && failure.message === 'COMMUNITY_REQUEST_MESSAGE_RATE_LIMITED';
      setError(
        notPending
          ? 'notPending'
          : rateLimited
            ? 'rateLimited'
            : isTransportFailure(failure)
              ? 'unconfirmed'
              : 'failed'
      );
      if (notPending) setOpen(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        xstyle={styles.requestMessageTrigger}
        aria-label={t(
          sent
            ? 'communityAdmin.requestMessage.sent'
            : error === 'notPending'
              ? 'communityAdmin.requestMessage.notPending'
              : 'communityAdmin.requestMessage.action'
        )}
        variant="secondary"
        disabled={sent || error === 'notPending'}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <span aria-hidden="true">✉</span>
      </Button>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop {...stylex.props(styles.confirmBackdrop)} />
          <Dialog.Viewport {...stylex.props(styles.confirmViewport)}>
            <Dialog.Popup {...stylex.props(styles.confirmDialog)}>
              <Dialog.Title {...stylex.props(styles.confirmTitle)}>
                {t('communityAdmin.requestMessage.title')}
              </Dialog.Title>
              <Dialog.Description {...stylex.props(styles.copy)}>
                {t('communityAdmin.requestMessage.help')}
              </Dialog.Description>
              <form onSubmit={(event) => void submit(event)} {...stylex.props(styles.messageForm)}>
                <label htmlFor={`request-message-${membershipId}`}>
                  {t('communityAdmin.requestMessage.label')}
                </label>
                <textarea
                  id={`request-message-${membershipId}`}
                  maxLength={1000}
                  required
                  value={body}
                  disabled={busy}
                  onChange={(event) => setBody(event.currentTarget.value)}
                  {...stylex.props(styles.messageTextarea)}
                />
                {error && (
                  <p role="alert" {...stylex.props(styles.error)}>
                    {t(`communityAdmin.requestMessage.${error}`)}
                  </p>
                )}
                <div {...stylex.props(styles.actions)}>
                  <Button busy={busy} type="submit">
                    {t(
                      busy
                        ? 'communityAdmin.requestMessage.sending'
                        : 'communityAdmin.requestMessage.send'
                    )}
                  </Button>
                  <Dialog.Close render={<Button variant="secondary" disabled={busy} />}>
                    {t('communityAdmin.cancel')}
                  </Dialog.Close>
                </div>
              </form>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function AuditView(props: ViewProps<'audit'>) {
  const { community, audit } = props;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useParams({ strict: false });
  const communityId = params.communityId ?? '';
  const [additionalAudit, setAdditionalAudit] = useState<{
    source: CommunityAdminAudit[];
    rows: CommunityAdminAudit[];
  }>({ source: audit, rows: [] });
  const auditSourceRef = useRef(audit);
  const auditGeneration = useRef(0);
  const [hasMoreAudit, setHasMoreAudit] = useState(audit.length === 3);
  const [hasLoadedMoreAudit, setHasLoadedMoreAudit] = useState(false);
  const { message, setMessage, errorKey, setErrorKey } = useAdminMutationState();
  const [paginationPending, setPaginationPending] = useState(false);
  const locale = i18n.resolvedLanguage || i18n.language;
  const auditRows = additionalAudit.source === audit ? [...audit, ...additionalAudit.rows] : audit;

  useEffect(() => {
    if (auditSourceRef.current === audit) return;
    auditSourceRef.current = audit;
    auditGeneration.current += 1;
    setPaginationPending(false);
    setAdditionalAudit({ source: audit, rows: [] });
    setHasMoreAudit(audit.length === 3);
    setHasLoadedMoreAudit(false);
  }, [audit]);

  async function loadMoreAudit() {
    if (paginationPending || !hasMoreAudit) return;
    setPaginationPending(true);
    setHasLoadedMoreAudit(true);
    const source = audit;
    const generation = ++auditGeneration.current;
    try {
      const page = await listCommunityAudit({
        data: { community_id: community.id, offset: auditRows.length, limit: 3 }
      });
      if (auditSourceRef.current !== source || auditGeneration.current !== generation) return;
      setAdditionalAudit((previous) => ({
        source,
        rows: previous.source === source ? [...previous.rows, ...page] : page
      }));
      setHasMoreAudit(page.length === 3);
    } catch (error) {
      if (auditSourceRef.current === source && auditGeneration.current === generation)
        setErrorKey(failed(error));
    } finally {
      if (auditGeneration.current === generation) setPaginationPending(false);
    }
  }

  return (
    <AdminViewFrame communityId={communityId} communityName={community.name} screen="audit">
      <div {...stylex.props(styles.list)}>
        <p {...stylex.props(styles.banner)}>{t('communityAdmin.audit.recentChanges')}</p>
        {auditRows.length > 0 && (
          <div {...stylex.props(styles.listSurface)}>
            {auditRows.map((event) => (
              <SurfaceCard
                key={event.id}
                data-testid="community-audit-event"
                xstyle={[styles.card, styles.listRow]}
              >
                <span aria-hidden="true" {...stylex.props(styles.auditDot)} />
                <div {...stylex.props(styles.memberDetails)}>
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
                      {...stylex.props(styles.memberLink, styles.inlineLink)}
                    >
                      {t('communityAdmin.audit.openMember')}
                    </Link>
                  )}
                </div>
              </SurfaceCard>
            ))}
          </div>
        )}
        <p {...stylex.props(styles.note)}>
          {t('communityAdmin.audit.leagueCorrectionsUnavailable')}
        </p>
        {!auditRows.length && (
          <p {...stylex.props(styles.copy, styles.emptyState)}>{t('communityAdmin.empty.audit')}</p>
        )}
        {hasMoreAudit ? (
          <Button variant="secondary" busy={paginationPending} onClick={() => void loadMoreAudit()}>
            {t('communityAdmin.loadMore')}
          </Button>
        ) : (
          hasLoadedMoreAudit && (
            <p {...stylex.props(styles.copy)}>{t('communityAdmin.endOfList')}</p>
          )
        )}
      </div>
      {message && <output {...stylex.props(styles.status)}>{message}</output>}
      {errorKey && (
        <p role="alert" {...stylex.props(styles.error)}>
          {t(`communityAdmin.error.${errorKey}`)}
        </p>
      )}
      {errorKey && (
        <Button
          variant="secondary"
          onClick={() => {
            setMessage('');
            setErrorKey('');
            void router.invalidate();
          }}
        >
          {t('communityAdmin.retry')}
        </Button>
      )}
    </AdminViewFrame>
  );
}

function auditDateLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  }).format(new Date(value));
}

function auditEventKey(event: CommunityAdminAudit) {
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

function auditMemberDetails(event: CommunityAdminAudit) {
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

export function CommunityAdminDispatcher(props: CommunityAdminScreenProps) {
  switch (props.screen) {
    case 'requests':
      return <RequestsView {...props} />;
    case 'members':
      return <MembersView {...props} />;
    case 'member':
      return <MemberView {...props} />;
    case 'settings':
      return <SettingsView {...props} />;
    case 'venues':
      return <VenuesView {...props} />;
    case 'audit':
      return <AuditView {...props} />;
  }
  return null;
}
