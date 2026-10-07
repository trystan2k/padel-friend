import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { Button } from '../../components/ui/Button';
import { StepBadge } from '../../components/ui/StepBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { TextField } from '../../components/ui/TextField';
import { stripDisplayNameEdgeWhitespace } from '../player/display-name';
import { createCommunity, joinCommunity, listPublicCommunities } from './community.functions';
import type { PublicCommunity } from './community.validators';
import { ui } from './community-onboarding.styles';

type Search = { q?: string; view?: 'create' };
type Page = { communities: PublicCommunity[]; next_offset: number | null; failed: boolean };

function expired(error: unknown): boolean {
  return error instanceof Error && error.message === 'UNAUTHENTICATED';
}

export function CommunityOnboarding({ search, data }: { search: Search; data: Page }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
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
  const current = draft.trim() === query;
  const page = more?.query === query && more.source === data ? more.page : data;
  const rows = current ? page.communities : [];
  const nextOffset = current ? page.next_offset : null;
  const listError =
    current && (page.failed || (pageError?.query === query && pageError.source === data));
  const [joining, setJoining] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

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
        search: { ...(nextQuery ? { q: nextQuery } : {}) },
        replace: true
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, navigate, search.q, search.view]);

  function login() {
    window.location.assign('/login?next=/onboarding/community');
  }

  async function join(community: PublicCommunity) {
    if (joining || (results[community.id] && results[community.id] !== 'joinFailed')) return;
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
    <main {...stylex.props(ui.page)}>
      <div {...stylex.props(ui.top)}>
        <StepBadge>
          {t(create ? 'communityOnboarding.createStep' : 'communityOnboarding.step')}
        </StepBadge>
        <header {...stylex.props(ui.header)}>
          <h1 {...stylex.props(ui.title)}>
            {t(create ? 'communityOnboarding.createTitle' : 'communityOnboarding.title')}
          </h1>
          <p {...stylex.props(ui.subtitle)}>
            {t(create ? 'communityOnboarding.createSubtitle' : 'communityOnboarding.subtitle')}
          </p>
        </header>
      </div>
      {create ? (
        <CreateCommunityView
          onBack={() => {
            navigationOrigin.current = { query: draft.trim(), revision: editRevision.current };
            void navigate({
              to: '/onboarding/community',
              search: { ...(draft.trim() ? { q: draft.trim() } : {}) }
            });
          }}
        />
      ) : (
        <div {...stylex.props(ui.content)}>
          <div {...stylex.props(ui.intro)}>
            <h2 {...stylex.props(ui.lead)}>{t('communityOnboarding.lead')}</h2>
            <p {...stylex.props(ui.help)}>{t('communityOnboarding.help')}</p>
          </div>
          <div {...stylex.props(ui.search)}>
            <label htmlFor="community-search" {...stylex.props(ui.hidden)}>
              {t('communityOnboarding.searchLabel')}
            </label>
            <span aria-hidden="true" {...stylex.props(ui.searchIcon)}>
              ⌕
            </span>
            <input
              id="community-search"
              aria-label={t('communityOnboarding.searchLabel')}
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
              {...stylex.props(ui.optionalInput, ui.searchInput)}
            />
          </div>
          {listError && (
            <p role="alert" {...stylex.props(ui.error)}>
              {t('communityOnboarding.loadFailed')}
            </p>
          )}
          {listError && (
            <Button variant="secondary" onClick={() => void router.invalidate()}>
              {t('communityOnboarding.retry')}
            </Button>
          )}
          {current && !listError && !rows.length && (
            <output {...stylex.props(ui.help)}>
              {t(
                search.q ? 'communityOnboarding.emptySearch' : 'communityOnboarding.noCommunities'
              )}
            </output>
          )}
          {rows.map((community) => (
            <SurfaceCard key={community.id} xstyle={ui.card}>
              <h3 {...stylex.props(ui.cardTitle)}>{community.name}</h3>
              <p {...stylex.props(ui.meta)}>
                {t('communityOnboarding.cityPolicy', {
                  city: community.city_label || t('communityOnboarding.cityUnknown'),
                  policy: t(
                    community.join_policy === 'instant'
                      ? 'communityOnboarding.openJoin'
                      : 'communityOnboarding.approvalRequired'
                  )
                })}
              </p>
              {results[community.id] && (
                <output
                  {...stylex.props(results[community.id] === 'joinFailed' ? ui.error : ui.status)}
                >
                  {t(`communityOnboarding.${results[community.id]}`)}
                </output>
              )}
              <Button
                variant="secondary"
                xstyle={[
                  ui.cardAction,
                  community.join_policy === 'admin_approval' && ui.requestAction
                ]}
                busy={joining === community.id}
                disabled={Boolean(results[community.id]) && results[community.id] !== 'joinFailed'}
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
            </SurfaceCard>
          ))}
          {nextOffset !== null && (
            <Button variant="secondary" busy={loadingMore} onClick={() => void loadMore()}>
              {t('communityOnboarding.loadMore')}
            </Button>
          )}
          <Button
            onClick={() => {
              navigationOrigin.current = { query: draft.trim(), revision: editRevision.current };
              void navigate({
                to: '/onboarding/community',
                search: { ...(draft.trim() ? { q: draft.trim() } : {}), view: 'create' }
              });
            }}
          >
            {t('communityOnboarding.createEntry')}
          </Button>
          <Button
            variant="secondary"
            xstyle={ui.transparentAction}
            onClick={() => void navigate({ to: '/dashboard' })}
          >
            {t('communityOnboarding.skip')}
          </Button>
        </div>
      )}
    </main>
  );
}

function CreateCommunityView({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [nameError, setNameError] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const normalized = stripDisplayNameEdgeWhitespace(name);
    if (!normalized || Array.from(normalized).length > 80) {
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    setNameError(false);
    setCreateError(false);
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
      setCreateError(true);
    } finally {
      setCreating(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate {...stylex.props(ui.form)}>
      <div {...stylex.props(ui.intro, ui.createIntro)}>
        <h2 {...stylex.props(ui.lead)}>{t('communityOnboarding.createLead')}</h2>
        <p {...stylex.props(ui.help)}>{t('communityOnboarding.createHelp')}</p>
      </div>
      {created ? (
        <>
          <output {...stylex.props(ui.status)}>{t('communityOnboarding.created')}</output>
          <Button onClick={() => void navigate({ to: '/dashboard' })}>
            {t('communityOnboarding.finish')}
          </Button>
        </>
      ) : (
        <>
          <TextField
            id="community-name"
            ref={nameRef}
            label={t('communityOnboarding.nameLabel')}
            placeholder={t('communityOnboarding.nameExample')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            error={nameError ? t('communityOnboarding.invalidName') : undefined}
          />
          <SurfaceCard xstyle={ui.visibilityCard}>
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
                    <span
                      {...stylex.props(ui.optionTitle, visibility === option && ui.selectedTitle)}
                    >
                      {t(`communityOnboarding.${option}`)}
                    </span>
                    <span {...stylex.props(ui.optionHelp)}>
                      {t(`communityOnboarding.${option}Help`)}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </SurfaceCard>
          <SurfaceCard xstyle={ui.optional}>
            <span {...stylex.props(ui.label, ui.optionalHeading)}>
              {t('communityOnboarding.optionalDetails')}
            </span>
            <label {...stylex.props(ui.hidden)} htmlFor="community-description">
              {t('communityOnboarding.descriptionLabel')}
            </label>
            <input
              id="community-description"
              {...stylex.props(ui.optionalInput)}
              placeholder={t('communityOnboarding.descriptionExample')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
            />
            <label {...stylex.props(ui.hidden)} htmlFor="community-city">
              {t('communityOnboarding.cityLabel')}
            </label>
            <input
              id="community-city"
              {...stylex.props(ui.optionalInput, ui.divider)}
              placeholder={t('communityOnboarding.cityExample')}
              value={city}
              onChange={(event) => setCity(event.target.value)}
              maxLength={120}
            />
          </SurfaceCard>
          <p {...stylex.props(ui.help)}>{t('communityOnboarding.adminNote')}</p>
          {createError && (
            <p role="alert" {...stylex.props(ui.error)}>
              {t('communityOnboarding.createFailed')}
            </p>
          )}
          <Button type="submit" busy={creating}>
            {t(creating ? 'communityOnboarding.creating' : 'communityOnboarding.createSubmit')}
          </Button>
          <Button variant="secondary" xstyle={ui.transparentAction} onClick={onBack}>
            {t('communityOnboarding.back')}
          </Button>
        </>
      )}
    </form>
  );
}
