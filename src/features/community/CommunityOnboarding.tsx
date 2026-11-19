import { useUpdateGuard } from '../pwa/update-guard';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { TextField } from '../../components/ui/TextField';
import { stripEdgeWhitespace } from '../../lib/edge-whitespace';
import { createCommunity, joinCommunity, listPublicCommunities } from './community.functions';
import type { PublicCommunity } from './community.validators';
import { ui } from './community-onboarding.styles';
import { normalizeReturnPath, optionalReturnPath } from '../auth/return-path';

type Search = { q?: string; view?: 'create'; next?: string };
type Page = { communities: PublicCommunity[]; next_offset: number | null; failed: boolean };

const createLimitErrors: Record<string, string> = {
  COMMUNITY_CREATE_RATE_LIMITED: 'createRateLimited',
  COMMUNITY_OWNED_LIMIT_REACHED: 'createOwnedLimit'
};

function expired(error: unknown): boolean {
  return error instanceof Error && error.message === 'UNAUTHENTICATED';
}

export function CommunityOnboarding({
  search,
  data,
  next: returnPath
}: {
  search: Search;
  data: Page;
  next?: string;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const routePending = useRouterState({
    select: (state) =>
      state.matches.some(
        (match) =>
          match.routeId === '/onboarding_/community' &&
          (match.status === 'pending' || match.isFetching)
      )
  });
  const [draft, setDraft] = useState(search.q ?? '');
  const [more, setMore] = useState<{ query: string; source: Page; page: Page } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<{ query: string; source: Page } | null>(null);
  const requestVersion = useRef(0);
  const draftRef = useRef(draft);
  const editRevision = useRef(0);
  const syncedRevision = useRef(0);
  const navigationOrigin = useRef<{ query: string; revision: number } | null>(null);
  const historyNavigation = useRef(false);
  const previousSearch = useRef({ query: search.q ?? '', view: search.view });
  const query = search.q ?? '';
  const safeNext = normalizeReturnPath(returnPath);
  const finish = useCallback(() => {
    if (returnPath) window.location.assign(safeNext);
    else void navigate({ to: '/dashboard' });
  }, [returnPath, safeNext, navigate]);
  const current = draft.trim() === query;
  const page = more?.query === query && more.source === data ? more.page : data;
  const rows = current ? page.communities : [];
  const nextOffset = current ? page.next_offset : null;
  const listError =
    current && (page.failed || (pageError?.query === query && pageError.source === data));
  const [joining, setJoining] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  useUpdateGuard(joining !== null || Object.values(results).includes('joinFailed'));

  useEffect(() => {
    const onHistoryNavigation = () => {
      historyNavigation.current = true;
    };
    window.addEventListener('popstate', onHistoryNavigation);
    return () => window.removeEventListener('popstate', onHistoryNavigation);
  }, []);

  useEffect(() => {
    if (previousSearch.current.query !== query || previousSearch.current.view !== search.view) {
      const origin = navigationOrigin.current;
      if (
        historyNavigation.current ||
        (origin?.query === query && origin.revision === editRevision.current) ||
        (!origin && editRevision.current === syncedRevision.current)
      ) {
        draftRef.current = query;
        setDraft(query);
        syncedRevision.current = editRevision.current;
      }
      // Keep the history target as an origin: a late response from the previous
      // search must not look like an unrelated, authoritative query change.
      if (historyNavigation.current)
        navigationOrigin.current = { query, revision: editRevision.current };
      else if (origin?.query === query) navigationOrigin.current = null;
      historyNavigation.current = false;
      previousSearch.current = { query, view: search.view };
      requestVersion.current++;
    }
  }, [query, search.view]);

  useEffect(() => {
    if (search.view === 'create' || draft === (search.q ?? '')) return undefined;
    const revision = editRevision.current;
    const nextQuery = draft.trim();
    const timer = setTimeout(() => {
      navigationOrigin.current = { query: nextQuery, revision };
      void navigate({
        to: '/onboarding/community',
        search: {
          ...(nextQuery ? { q: nextQuery } : {}),
          ...optionalReturnPath(returnPath)
        },
        replace: true
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, navigate, search.q, search.view, returnPath]);

  function login() {
    window.location.assign('/login?next=/onboarding/community');
  }

  async function join(community: PublicCommunity) {
    if (
      joining ||
      (results[community.id] && !['joinFailed', 'offline'].includes(results[community.id] ?? ''))
    )
      return;
    if (!navigator.onLine) {
      setResults((previous) => ({ ...previous, [community.id]: 'offline' }));
      return;
    }
    setJoining(community.id);
    try {
      const result = await joinCommunity({ data: { community_id: community.id } });
      setResults((previous) => ({
        ...previous,
        [community.id]: result.status === 'active' ? 'joined' : 'requestPending'
      }));
    } catch (error) {
      if (expired(error)) return login();
      setResults((previous) => ({
        ...previous,
        [community.id]:
          error instanceof Error && error.message === 'ALREADY_MEMBER_OR_PENDING'
            ? 'alreadyMember'
            : error instanceof Error && error.message === 'MEMBERSHIP_INACTIVE'
              ? 'membershipInactive'
              : 'joinFailed'
      }));
    } finally {
      setJoining(null);
    }
  }

  async function loadMore() {
    if (nextOffset === null || loadingMore || listError) return;
    const version = requestVersion.current;
    const source = data;
    const activeQuery = query;
    setLoadingMore(true);
    try {
      const result = await listPublicCommunities({
        data: { ...(activeQuery ? { search: activeQuery } : {}), offset: nextOffset, limit: 20 }
      });
      if (version !== requestVersion.current || draftRef.current.trim() !== activeQuery) return;
      setMore({
        query: activeQuery,
        source,
        page: {
          communities: [...rows, ...result.communities],
          next_offset: result.next_offset,
          failed: false
        }
      });
      setPageError(null);
    } catch (error) {
      if (expired(error)) return login();
      if (version === requestVersion.current && draftRef.current.trim() === activeQuery)
        setPageError({ query: activeQuery, source });
    } finally {
      setLoadingMore(false);
    }
  }

  const create = search.view === 'create';
  return (
    <main {...stylex.props(ui.page)} data-community-screen={create ? 'creation' : 'discovery'}>
      {!create && (
        <header {...stylex.props(ui.top)}>
          <p {...stylex.props(ui.topTitle, ui.discoveryTopTitle)}>
            {t('communityOnboarding.title')}
          </p>
        </header>
      )}
      {create ? (
        <CreateCommunityView
          onFinish={finish}
          onBack={() => {
            navigationOrigin.current = { query: draft.trim(), revision: editRevision.current };
            void navigate({
              to: '/onboarding/community',
              search: {
                ...(draft.trim() ? { q: draft.trim() } : {}),
                ...optionalReturnPath(returnPath)
              }
            });
          }}
        />
      ) : (
        <div {...stylex.props(ui.content)}>
          <div aria-hidden="true" {...stylex.props(ui.progress)}>
            <span {...stylex.props(ui.segment)} />
            <span {...stylex.props(ui.segment)} />
            <span {...stylex.props(ui.segment)} />
          </div>
          <p aria-current="step" {...stylex.props(ui.step)}>
            {t('communityOnboarding.step')}
          </p>
          <h1 {...stylex.props(ui.title)}>{t('communityOnboarding.lead')}</h1>
          <p {...stylex.props(ui.help)}>{t('communityOnboarding.help')}</p>
          <search {...stylex.props(ui.search)}>
            <label htmlFor="community-search" {...stylex.props(ui.hidden)}>
              {t('communityOnboarding.searchLabel')}
            </label>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              {...stylex.props(ui.searchIcon)}
            >
              <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="2" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              id="community-search"
              name="q"
              autoCapitalize="none"
              spellCheck={false}
              type="search"
              value={draft}
              maxLength={80}
              placeholder={t('communityOnboarding.searchPlaceholder')}
              onChange={(event) => {
                draftRef.current = event.target.value;
                editRevision.current++;
                requestVersion.current++;
                setDraft(event.target.value);
                setPageError(null);
              }}
              {...stylex.props(ui.searchInput)}
            />
          </search>
          {listError && (
            <p role="alert" {...stylex.props(ui.error)}>
              {t('communityOnboarding.loadFailed')}
            </p>
          )}
          {listError && (
            <Button
              variant="secondary"
              busy={routePending}
              disabled={routePending}
              onClick={() => void router.invalidate()}
            >
              {t('communityOnboarding.retry')}
            </Button>
          )}
          {(routePending || (!current && search.view !== 'create')) && (
            <output {...stylex.props(ui.status)}>{t('communityOnboarding.searchLoading')}</output>
          )}
          <div aria-busy={routePending || !current} {...stylex.props(ui.results)}>
            {current && !routePending && !listError && !rows.length && (
              <output {...stylex.props(ui.help)}>
                {t(
                  search.q ? 'communityOnboarding.emptySearch' : 'communityOnboarding.noCommunities'
                )}
              </output>
            )}
            {rows.map((community) => (
              <SurfaceCard key={community.id} xstyle={ui.card}>
                <span aria-hidden="true" {...stylex.props(ui.glyph)}>
                  {Array.from(community.name)[0]?.toLocaleUpperCase(i18n.resolvedLanguage)}
                </span>
                <div {...stylex.props(ui.cardDetails)}>
                  <h2 {...stylex.props(ui.cardTitle)}>{community.name}</h2>
                  <p {...stylex.props(ui.meta)}>
                    <span>
                      {t('communityOnboarding.cityPolicy', {
                        city: community.city_label || t('communityOnboarding.cityUnknown'),
                        policy: t(
                          community.join_policy === 'instant'
                            ? 'communityOnboarding.openJoin'
                            : 'communityOnboarding.approvalRequired'
                        )
                      })}
                    </span>
                    {' · '}
                    <span>
                      {t('communityOnboarding.memberCount', {
                        count: community.member_count,
                        formattedCount: new Intl.NumberFormat(i18n.resolvedLanguage).format(
                          community.member_count
                        )
                      })}
                    </span>
                  </p>
                </div>
                <Button
                  xstyle={ui.cardAction}
                  busy={joining === community.id}
                  disabled={
                    Boolean(results[community.id]) &&
                    !['joinFailed', 'offline'].includes(results[community.id] ?? '')
                  }
                  onClick={() => void join(community)}
                >
                  {t(
                    joining === community.id
                      ? community.join_policy === 'instant'
                        ? 'communityOnboarding.joining'
                        : 'communityOnboarding.requesting'
                      : community.join_policy === 'instant'
                        ? 'communityOnboarding.join'
                        : 'communityOnboarding.requestToJoin'
                  )}
                </Button>
                {results[community.id] && (
                  <output
                    {...stylex.props(
                      ui.cardStatus,
                      ['joinFailed', 'offline'].includes(results[community.id] ?? '')
                        ? ui.error
                        : ui.status
                    )}
                  >
                    {t(`communityOnboarding.${results[community.id]}`)}
                  </output>
                )}
              </SurfaceCard>
            ))}
          </div>
          {nextOffset !== null && (
            <Button variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>
              {t('communityOnboarding.loadMore')}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              navigationOrigin.current = { query: draft.trim(), revision: editRevision.current };
              void navigate({
                to: '/onboarding/community',
                search: {
                  ...(draft.trim() ? { q: draft.trim() } : {}),
                  view: 'create',
                  ...optionalReturnPath(returnPath)
                }
              });
            }}
          >
            {t('communityOnboarding.createEntry')}
          </Button>
          <footer {...stylex.props(ui.actions)} data-community-actions>
            {Object.values(results).some(
              (result) => result === 'joined' || result === 'requestPending'
            ) && <Button onClick={finish}>{t('communityOnboarding.done')}</Button>}
            <Button variant="secondary" xstyle={ui.transparentAction} onClick={finish}>
              {t('communityOnboarding.skip')}
            </Button>
          </footer>
        </div>
      )}
    </main>
  );
}

function CreateCommunityView({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [nameError, setNameError] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const normalized = stripEdgeWhitespace(name);
    if (!normalized || Array.from(normalized).length > 80) {
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    setNameError(false);
    setCreateError(null);
    setCreating(true);
    try {
      await createCommunity({
        data: {
          name: normalized,
          visibility,
          join_policy: visibility === 'public' ? 'instant' : 'admin_approval',
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(city.trim() ? { city_label: city.trim() } : {})
        }
      });
      setCreated(true);
    } catch (error) {
      if (expired(error)) {
        window.location.assign('/login?next=/onboarding/community');
        return;
      }
      const message = error instanceof Error ? error.message : '';
      setCreateError(
        Object.hasOwn(createLimitErrors, message)
          ? (createLimitErrors[message] ?? 'createFailed')
          : 'createFailed'
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <header {...stylex.props(ui.top)}>
        {!created && (
          <Button
            variant="secondary"
            xstyle={ui.back}
            onClick={onBack}
            aria-label={t('communityOnboarding.back')}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none">
              <path
                d="m15 6-6 6 6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
        )}
        <p {...stylex.props(ui.topTitle)}>{t('communityOnboarding.createTitle')}</p>
      </header>
      <form onSubmit={(event) => void submit(event)} noValidate {...stylex.props(ui.form)}>
        <h1 {...stylex.props(ui.title)}>{t('communityOnboarding.createLead')}</h1>
        {created ? (
          <>
            <output {...stylex.props(ui.status)}>{t('communityOnboarding.created')}</output>
            <Button onClick={onFinish}>{t('communityOnboarding.finish')}</Button>
          </>
        ) : (
          <>
            <TextField
              id="community-name"
              name="name"
              ref={nameRef}
              label={t('communityOnboarding.nameLabel')}
              placeholder={t('communityOnboarding.nameExample')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              error={nameError ? t('communityOnboarding.invalidName') : undefined}
            />
            <TextField
              id="community-city"
              name="city"
              label={t('communityOnboarding.cityLabel')}
              placeholder={t('communityOnboarding.cityExample')}
              value={city}
              onChange={(event) => setCity(event.target.value)}
              maxLength={120}
            />
            <TextField
              id="community-description"
              name="description"
              label={t('communityOnboarding.descriptionLabel')}
              placeholder={t('communityOnboarding.descriptionExample')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
            />
            <div {...stylex.props(ui.visibilityCard)}>
              <span id="community-visibility-label" {...stylex.props(ui.label)}>
                {t('communityOnboarding.visibilityLegend')}
              </span>
              <RadioGroup
                aria-labelledby="community-visibility-label"
                name="visibility"
                value={visibility}
                onValueChange={(value) => setVisibility(value)}
                {...stylex.props(ui.radioGroup)}
              >
                {(['public', 'private'] as const).map((option) => (
                  <label
                    key={option}
                    htmlFor={`visibility-${option}`}
                    {...stylex.props(ui.option, visibility === option && ui.selected)}
                  >
                    <Radio.Root
                      id={`visibility-${option}`}
                      value={option}
                      {...stylex.props(ui.radio)}
                    />
                    <span {...stylex.props(ui.optionText)}>
                      <span {...stylex.props(ui.optionTitle)}>
                        {t(`communityOnboarding.${option}`)}
                      </span>
                      <span {...stylex.props(ui.optionHelp)}>
                        {t(`communityOnboarding.${option}Help`)}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
            <footer {...stylex.props(ui.actions)} data-community-actions>
              <p {...stylex.props(ui.adminNote)}>{t('communityOnboarding.adminNote')}</p>
              {createError && (
                <p role="alert" {...stylex.props(ui.error)}>
                  {t(`communityOnboarding.${createError}`)}
                </p>
              )}
              <Button type="submit" busy={creating}>
                {t(creating ? 'communityOnboarding.creating' : 'communityOnboarding.createSubmit')}
              </Button>
            </footer>
          </>
        )}
      </form>
    </>
  );
}
