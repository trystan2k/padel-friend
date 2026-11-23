import * as stylex from '@stylexjs/stylex';
import { Button } from '../../components/ui/Button';
import { TextLink } from '../../components/ui/TextLink';
import { validMatchMapsUrl } from './match-management-edit';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MatchDetailsForm } from './MatchDetailsForm';
import { MatchInviteePicker } from './MatchInviteePicker';
import { MatchPlayersForm } from './MatchPlayersForm';
import { MatchPhotoUpload } from './MatchPhotoUpload';
import { MatchReview } from './MatchReview';
import { createMatchStyles as s } from './create-match.styles';
import { isOffline, isTransportFailure } from '../../lib/connectivity';
import { localMatchInstant } from './match-time';
import type {
  MatchCreationOptions,
  MatchDraft,
  MatchInvitee,
  MatchLeagueOption,
  MatchPublishInput
} from './match-contracts';
import {
  matchCompetitionInput,
  resolveMatchCompetition,
  type MatchLeagueOptionsStatus
} from './match-league-selection';
import {
  getMatchCreationOptions,
  getMatchLeagueOptions,
  publishMatchEvent
} from './matches.functions';
import { copySavedVenueMatchPhotoFn, removeUnpublishedMatchPhotoFn } from './match-photo.functions';

const blank: MatchDraft = {
  type: 'friendly',
  competitionChoice: 'auto',
  leagueId: '',
  visibility: 'community_open',
  teamMode: 'POST_MATCH_TEAMS',
  levelRestriction: true,
  currency: 'EUR',
  community_id: '',
  timezone: null,
  date: '',
  startTime: '',
  savedVenue: '',
  venueName: '',
  mapsUrl: '',
  courtNotes: '',
  duration: '',
  notes: '',
  minLevel: '',
  maxLevel: '',
  courtBooked: false,
  price: '',
  paymentNote: '',
  maximumRegistrations: '',
  cutoff: ''
};
const emptyOptions: MatchCreationOptions = {
  communities: [],
  saved_venues: [],
  level_defaults: null
};
type LeagueOptionsState = { key: string; status: 'ready' | 'error'; leagues: MatchLeagueOption[] };
type FrozenRequest = { id: string; input: MatchPublishInput; inviteeIds: string[] };
// Visible, focusable wizard controls: Base UI renders a hidden `aria-hidden` input beside each radio and
// switch, so those inputs are skipped in favor of the radio/switch element itself.
const firstControl =
  'input:not([aria-hidden="true"]), select, button, [role="radio"], [role="switch"]';
function focusFirstControl(root: HTMLElement | null) {
  const first = root?.querySelector<HTMLElement>(firstControl);
  // Within a radio group the checked radio is the one in the tab order.
  const checked = first
    ?.closest('[role="radiogroup"]')
    ?.querySelector<HTMLElement>('[aria-checked="true"]');
  (checked ?? first)?.focus();
}
// Draft fields whose control lives on the Players step; every other validated field is on Details.
const playersStepErrors = ['minLevel', 'maximumRegistrations'];

export function CreateMatchPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const optionsGeneration = useRef(0);
  const leagueGeneration = useRef(0);
  const publishLock = useRef(false);
  const frozen = useRef<FrozenRequest | null>(null);
  const publicationFailed = useRef(false);
  const photoRef = useRef('');
  const copiedPhoto = useRef<{ key: string } | null>(null);
  const photoCopyGeneration = useRef(0);
  const editedRange = useRef({ min: false, max: false });
  const [options, setOptions] = useState<MatchCreationOptions>(emptyOptions);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState(false);
  const [leagueState, setLeagueState] = useState<LeagueOptionsState | null>(null);
  const [leagueReload, setLeagueReload] = useState(0);
  const [communityId, setCommunityId] = useState('');
  const [value, setValue] = useState<MatchDraft>(blank);
  const [step, setStep] = useState(0);
  const [invitees, setInvitees] = useState<MatchInvitee[]>([]);
  const [photo, setPhoto] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoCopyBusy, setPhotoCopyBusy] = useState(false);
  const [photoCopyError, setPhotoCopyError] = useState(false);
  const [eventId, setEventId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const headingLabels = ['details', 'players', 'teams', 'review'] as const;

  const changePhoto = useCallback((next: string) => {
    if (publicationFailed.current && next !== photoRef.current) {
      frozen.current = null;
      publicationFailed.current = false;
    }
    photoRef.current = next;
    if (copiedPhoto.current?.key !== next) copiedPhoto.current = null;
    setPhoto(next);
    if (next) setPhotoCopyError(false);
  }, []);

  useEffect(
    () => () => {
      photoCopyGeneration.current++;
    },
    []
  );

  useEffect(() => {
    const generation = ++optionsGeneration.current;
    void getMatchCreationOptions({ data: {} })
      .then((result) => {
        if (generation !== optionsGeneration.current) return;
        const next = result;
        setOptions(next);
        const first = next.communities[0];
        if (first) {
          const id = crypto.randomUUID();
          setCommunityId(first.id);
          setEventId(id);
          setValue((current) => ({
            ...current,
            community_id: first.id,
            timezone: first.timezone,
            minLevel:
              current.minLevel ||
              (next.level_defaults?.min == null ? '' : String(next.level_defaults.min)),
            maxLevel:
              current.maxLevel ||
              (next.level_defaults?.max == null ? '' : String(next.level_defaults.max))
          }));
          // The unscoped response supplies memberships/defaults only. Fetch venue
          // snapshots once the initial membership is known, just like later switches.
          void getMatchCreationOptions({ data: { community_id: first.id } })
            .then((scoped) => {
              if (generation !== optionsGeneration.current) return;
              setOptions({ ...scoped, communities: next.communities });
            })
            .catch(() => {
              if (generation === optionsGeneration.current) setOptionsError(true);
            });
        }
        setOptionsError(false);
      })
      .catch(() => {
        if (generation === optionsGeneration.current) setOptionsError(true);
      })
      .finally(() => {
        if (generation === optionsGeneration.current) setOptionsLoading(false);
      });
    return () => {
      optionsGeneration.current += 1;
    };
  }, []);

  // Eligible Leagues depend on the community and the intended UTC start. Each request carries a
  // generation so a slow response for an older community/schedule can never overwrite newer state.
  const leagueKey =
    value.type === 'competitive' && communityId && value.date && value.startTime
      ? `${communityId}|${value.date}|${value.startTime}|${leagueReload}`
      : '';
  useEffect(() => {
    const generation = ++leagueGeneration.current;
    if (leagueKey)
      void getMatchLeagueOptions({
        data: { community_id: communityId, date: value.date, start_time: value.startTime }
      })
        .then((result) => {
          if (generation === leagueGeneration.current)
            setLeagueState({ key: leagueKey, status: 'ready', leagues: result.leagues });
        })
        .catch(() => {
          if (generation === leagueGeneration.current)
            setLeagueState({ key: leagueKey, status: 'error', leagues: [] });
        });
    return () => {
      leagueGeneration.current += 1;
    };
  }, [leagueKey, communityId, value.date, value.startTime]);
  const retryLeagueOptions = useCallback(() => setLeagueReload((current) => current + 1), []);

  useLayoutEffect(() => {
    if (step >= 0) focusFirstControl(formRef.current);
  }, [step]);
  useLayoutEffect(() => {
    if (step >= 0 && Object.keys(fieldErrors).length)
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldErrors, step]);

  const retryScopedOptions = useCallback(() => {
    if (!communityId) return;
    const generation = ++optionsGeneration.current;
    setOptionsLoading(true);
    setOptionsError(false);
    void getMatchCreationOptions({ data: { community_id: communityId } })
      .then((result) => {
        if (generation !== optionsGeneration.current) return;
        setOptions((current) => ({ ...result, communities: current.communities }));
      })
      .catch(() => {
        if (generation === optionsGeneration.current) setOptionsError(true);
      })
      .finally(() => {
        if (generation === optionsGeneration.current) setOptionsLoading(false);
      });
  }, [communityId]);

  const change = useCallback(
    <K extends keyof MatchDraft>(key: K, next: MatchDraft[K]) => {
      if (key === 'minLevel') editedRange.current.min = true;
      if (key === 'maxLevel') editedRange.current.max = true;
      let photoEventId = eventId;
      if (publicationFailed.current) {
        frozen.current = null;
        publicationFailed.current = false;
        photoEventId = crypto.randomUUID();
        setEventId(photoEventId);
        const abandoned = photoRef.current;
        photoRef.current = '';
        setPhoto('');
        if (abandoned)
          void removeUnpublishedMatchPhotoFn({ data: { object_key: abandoned } }).catch(
            () => undefined
          );
      }
      if (key === 'savedVenue' && typeof next === 'string') {
        const venue = options.saved_venues.find((item) => item.id === next);
        const previousCopy = copiedPhoto.current;
        const replacingCopy = Boolean(previousCopy && photoRef.current === previousCopy.key);
        const currentPhoto = photoRef.current;
        const generation = ++photoCopyGeneration.current;
        setPhotoCopyBusy(false);
        if (replacingCopy && previousCopy) {
          changePhoto('');
          void removeUnpublishedMatchPhotoFn({ data: { object_key: previousCopy.key } }).catch(
            () => undefined
          );
        }
        setValue((current) => ({
          ...current,
          savedVenue: next,
          ...(venue ? { venueName: venue.name, mapsUrl: venue.maps_url ?? current.mapsUrl } : {})
        }));
        setPhotoCopyError(false);
        if (venue?.photo_path && (!currentPhoto || replacingCopy)) {
          setPhotoCopyBusy(true);
          void copySavedVenueMatchPhotoFn({
            data: {
              community_id: communityId,
              event_id: photoEventId,
              saved_venue_id: next
            }
          })
            .then((savedPhotoKey) => {
              if (generation !== photoCopyGeneration.current || photoRef.current) {
                void removeUnpublishedMatchPhotoFn({ data: { object_key: savedPhotoKey } }).catch(
                  () => undefined
                );
                return;
              }
              copiedPhoto.current = { key: savedPhotoKey };
              changePhoto(savedPhotoKey);
            })
            .catch(() => {
              if (generation === photoCopyGeneration.current) setPhotoCopyError(true);
            })
            .finally(() => {
              if (generation === photoCopyGeneration.current) setPhotoCopyBusy(false);
            });
        }
        return;
      }
      if (key === 'levelRestriction' && next === false) {
        setValue((current) => ({
          ...current,
          levelRestriction: false,
          minLevel: '',
          maxLevel: ''
        }));
      } else {
        setValue((current) => ({ ...current, [key]: next }));
      }
    },
    [changePhoto, communityId, eventId, options.saved_venues]
  );

  const selectCommunity = useCallback(
    (id: string) => {
      if (id === communityId) return;
      const abandonedPhoto = photoRef.current;
      photoCopyGeneration.current++;
      copiedPhoto.current = null;
      optionsGeneration.current += 1;
      const generation = optionsGeneration.current;
      setCommunityId(id);
      changePhoto('');
      setPhotoCopyBusy(false);
      setPhotoCopyError(false);
      setInvitees([]);
      setFieldErrors({});
      setError('');
      frozen.current = null;
      publicationFailed.current = false;
      editedRange.current = { min: false, max: false };
      const community = options.communities.find((item) => item.id === id);
      const nextEventId = crypto.randomUUID();
      setEventId(nextEventId);
      setValue({
        ...blank,
        community_id: id,
        timezone: community?.timezone ?? null,
        minLevel: options.level_defaults?.min == null ? '' : String(options.level_defaults.min),
        maxLevel: options.level_defaults?.max == null ? '' : String(options.level_defaults.max)
      });
      if (abandonedPhoto)
        void removeUnpublishedMatchPhotoFn({ data: { object_key: abandonedPhoto } }).catch(
          () => undefined
        );
      setOptionsLoading(true);
      setOptionsError(false);
      void getMatchCreationOptions({ data: { community_id: id } })
        .then((result) => {
          if (generation !== optionsGeneration.current) return;
          const next = { ...result, communities: options.communities };
          setOptions(next);
          setValue((current) => ({
            ...current,
            minLevel:
              !current.levelRestriction || editedRange.current.min
                ? current.minLevel
                : next.level_defaults?.min == null
                  ? ''
                  : String(next.level_defaults.min),
            maxLevel:
              !current.levelRestriction || editedRange.current.max
                ? current.maxLevel
                : next.level_defaults?.max == null
                  ? ''
                  : String(next.level_defaults.max)
          }));
        })
        .catch(() => {
          if (generation === optionsGeneration.current) setOptionsError(true);
        })
        .finally(() => {
          if (generation === optionsGeneration.current) setOptionsLoading(false);
        });
    },
    [changePhoto, communityId, options]
  );

  const timezone =
    options.communities.find((item) => item.id === communityId)?.timezone ??
    value.timezone ??
    'UTC';
  const startInstant = (() => {
    try {
      return value.date && value.startTime
        ? localMatchInstant(value.date, value.startTime, timezone).instant
        : null;
    } catch {
      return null;
    }
  })();
  const leagueOptionsStatus: MatchLeagueOptionsStatus = !leagueKey
    ? 'idle'
    : leagueState?.key === leagueKey
      ? leagueState.status
      : 'loading';
  const candidates = leagueOptionsStatus === 'ready' ? (leagueState?.leagues ?? []) : [];
  const resolution = resolveMatchCompetition(value.competitionChoice, value.leagueId, candidates);
  const competition = {
    status: leagueOptionsStatus,
    candidates,
    resolution,
    retry: retryLeagueOptions
  };
  const defaultCutoff = startInstant ? new Date(startInstant.getTime() - 60 * 60 * 1000) : null;
  const cutoffInstant = (() => {
    if (!value.cutoff) return defaultCutoff;
    try {
      return localMatchInstant(value.cutoff.slice(0, 10), value.cutoff.slice(11, 16), timezone)
        .instant;
    } catch {
      return null;
    }
  })();
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone
  });

  function validate(now: number) {
    const next: Record<string, string> = {};
    for (const key of ['community_id', 'date', 'startTime', 'venueName', 'mapsUrl'] as const)
      if (!value[key]) next[key] = 'required';
    if (!photo) next.photo = 'missingPhoto';
    // An explicit Unranked needs no League, so it never depends on the option list loading.
    if (value.type === 'competitive' && value.competitionChoice !== 'unranked') {
      if (leagueOptionsStatus !== 'ready') next.competition = 'leagueOptionsUnavailable';
      else if (resolution.needsSelection) next.competition = 'leagueRequired';
    }
    if (value.mapsUrl && !validMatchMapsUrl(value.mapsUrl)) next.mapsUrl = 'invalidMapsUrl';
    if (value.date && value.startTime) {
      try {
        if (!startInstant) next.startTime = 'invalidDateTime';
        else if (startInstant.getTime() <= now) next.startTime = 'pastStart';
      } catch {
        next.startTime = 'invalidDateTime';
      }
    }
    if (value.levelRestriction) {
      const min = Number(value.minLevel);
      const max = Number(value.maxLevel);
      if (
        value.minLevel === '' ||
        value.maxLevel === '' ||
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        min < 0 ||
        max > 7 ||
        min > max
      )
        next.minLevel = 'invalidLevelRange';
    }
    if (
      value.price !== '' &&
      (!Number.isFinite(Number(value.price)) ||
        Number(value.price) < 0 ||
        !/^\d+(\.\d{1,2})?$/.test(value.price))
    )
      next.price = Number(value.price) < 0 ? 'negativePrice' : 'invalidPrice';
    if (!['BRL', 'USD', 'EUR'].includes(value.currency)) next.currency = 'unsupportedCurrency';
    if (value.cutoff && (!cutoffInstant || !startInstant || cutoffInstant >= startInstant))
      next.cutoff = 'invalidCutoff';
    if (
      value.duration &&
      (!Number.isSafeInteger(Number(value.duration)) || Number(value.duration) < 1)
    )
      next.duration = 'invalidDuration';
    if (
      value.maximumRegistrations &&
      (!Number.isSafeInteger(Number(value.maximumRegistrations)) ||
        Number(value.maximumRegistrations) < 1)
    )
      next.maximumRegistrations = 'invalidCapacity';
    setFieldErrors(next);
    // Return to the step that owns the first invalid field; the layout effect focuses its control
    // once that step has mounted. Already on that step, focus the control directly.
    const owner = Object.keys(next).some((key) => !playersStepErrors.includes(key)) ? 0 : 1;
    if (Object.keys(next).length && step !== owner) setStep(owner);
    else formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return Object.keys(next).length === 0;
  }

  async function publish(now: number) {
    if (publishLock.current || !validate(now)) return;
    if (!photo || photoBusy) return;
    if (!communityId || !value.date || !value.startTime || !value.venueName || !value.mapsUrl)
      return;
    if (isOffline()) {
      setError('offline');
      return;
    }
    if (!frozen.current) {
      const id = eventId || crypto.randomUUID();
      const input = Object.freeze({
        community_id: communityId,
        date: value.date,
        start_time: value.startTime,
        event_type: value.type,
        ...matchCompetitionInput(value.type, resolution),
        visibility: value.visibility,
        venue_name: value.venueName,
        maps_url: value.mapsUrl,
        photo_path: photo,
        team_assignment_mode: value.teamMode,
        saved_venue_id: value.savedVenue || null,
        court_notes: value.courtNotes || null,
        duration_minutes: value.duration ? Number(value.duration) : null,
        notes: value.notes || null,
        restriction_enabled: value.levelRestriction,
        min_level: !value.levelRestriction ? null : Number(value.minLevel),
        max_level: !value.levelRestriction ? null : Number(value.maxLevel),
        court_booked: value.courtBooked,
        price: value.price === '' ? null : value.price,
        currency: value.currency,
        payment_note: value.paymentNote || null,
        maximum_registrations: value.maximumRegistrations
          ? Number(value.maximumRegistrations)
          : null,
        cutoff_at: cutoffInstant?.toISOString() ?? null
      } satisfies MatchPublishInput);
      frozen.current = {
        id,
        input,
        inviteeIds: invitees.map((person) => person.user_id)
      };
      setEventId(id);
    }
    const request = frozen.current;
    if (!request) return;
    publishLock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await publishMatchEvent({
        data: { event_id: request.id, input: request.input, invitee_ids: request.inviteeIds }
      });
      if (result?.event_id) {
        // Full-document refresh on successful publish: the dashboard preloads /matches
        // before the event exists, so a client-side navigation would land on a stale
        // Available list without the new publication.
        await navigate({ to: '/matches', reloadDocument: true });
      } else setError('publishFailed');
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : '';
      if (code.startsWith('MATCH_LEAGUE_')) {
        // League validation runs before anything is stored, so the same event id stays reusable.
        // Reload the candidates and unfreeze the payload instead of replaying a stale selection.
        frozen.current = null;
        publicationFailed.current = false;
        retryLeagueOptions();
      } else publicationFailed.current = true;
      const mapped: Record<string, string> = {
        MATCH_LEAGUE_NOT_FOUND: 'leagueUnavailable',
        MATCH_LEAGUE_CLOSED: 'leagueUnavailable',
        MATCH_LEAGUE_OUT_OF_PERIOD: 'leagueUnavailable',
        MATCH_LEAGUE_SELECTION_REQUIRED: 'leagueRequired',
        MATCH_CONFLICT: 'conflict',
        MATCH_NOT_MEMBER: 'notMember',
        MATCH_SAVED_VENUE_UNAVAILABLE: 'savedVenueUnavailable',
        MATCH_INVITEE_UNAVAILABLE: 'inviteeUnavailable',
        MATCH_PHOTO_UNAVAILABLE: 'photoUnauthorized',
        MATCH_EVENT_CREATE_RATE_LIMITED: 'rateLimited'
      };
      setError(isTransportFailure(cause) ? 'unconfirmed' : (mapped[code] ?? 'publishFailed'));
    } finally {
      publishLock.current = false;
      setBusy(false);
    }
  }

  const wizardHeader = (
    <header {...stylex.props(s.topBar)}>
      {step > 0 ? (
        <button
          type="button"
          aria-label={t('matchCreate.previousStep')}
          {...stylex.props(s.back)}
          onClick={() => setStep(step - 1)}
        >
          <BackIcon />
        </button>
      ) : (
        <Link to="/matches" aria-label={t('matches.back')} {...stylex.props(s.back)}>
          <BackIcon />
        </Link>
      )}
      <h1 {...stylex.props(s.title)} ref={heading} tabIndex={-1}>
        {t('matchCreate.title')}
      </h1>
    </header>
  );
  if (optionsLoading && !options.communities.length)
    return <main data-route-chrome="navigation" {...stylex.props(s.page)} aria-busy="true" />;
  if (optionsError && !options.communities.length)
    return (
      <main data-route-chrome="navigation" {...stylex.props(s.page)}>
        {wizardHeader}
        <div {...stylex.props(s.centered)}>
          <p role="alert" {...stylex.props(s.formMessage)}>
            {t('matchCreate.errors.optionsUnavailable')}
          </p>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            {t('matches.retry')}
          </Button>
        </div>
      </main>
    );
  if (!options.communities.length)
    return (
      <main data-route-chrome="navigation" {...stylex.props(s.page)}>
        {wizardHeader}
        <div {...stylex.props(s.centered)}>
          <p {...stylex.props(s.body)}>{t('matchCreate.noCommunities')}</p>
          <TextLink to="/onboarding/community">{t('matchCreate.discoverCommunities')}</TextLink>
        </div>
      </main>
    );
  // A competition error recorded at validation time goes stale once the League list or the
  // choice changes; only show it while the condition that raised it still holds.
  const { competition: competitionError, ...otherErrors } = fieldErrors;
  const competitionErrorActive =
    value.type === 'competitive' &&
    value.competitionChoice !== 'unranked' &&
    (competitionError === 'leagueOptionsUnavailable'
      ? leagueOptionsStatus !== 'ready'
      : competitionError === 'leagueRequired' && resolution.needsSelection);
  const activeErrors: Record<string, string> =
    competitionError && competitionErrorActive ? fieldErrors : otherErrors;
  const requiredInvalid = Object.keys(activeErrors).length > 0;
  return (
    <main data-route-chrome="navigation" {...stylex.props(s.page)}>
      {wizardHeader}
      {optionsError && (
        <div {...stylex.props(s.centered)}>
          <p role="alert" {...stylex.props(s.formMessage)}>
            {t('matchCreate.errors.optionsUnavailable')}
          </p>
          <Button variant="secondary" disabled={optionsLoading} onClick={retryScopedOptions}>
            {t('matches.retry')}
          </Button>
        </div>
      )}
      <div ref={formRef} {...stylex.props(s.form)}>
        <div {...stylex.props(s.content)}>
          <ol aria-hidden="true" {...stylex.props(s.progress)}>
            {headingLabels.map((label, index) => (
              <li
                key={label}
                data-step-state={index < step ? 'done' : index === step ? 'current' : 'todo'}
                {...stylex.props(index <= step ? s.segmentDone : s.segmentTodo)}
              />
            ))}
          </ol>
          <p {...stylex.props(s.stepLabel)}>
            {t('matchCreate.stepOf', { current: step + 1, total: headingLabels.length })} ·{' '}
            <span>{t(`matchCreate.steps.${headingLabels[step]}`)}</span>
          </p>
          {step === 0 && (
            <>
              <MatchDetailsForm
                value={{ ...value, community_id: communityId }}
                options={options}
                errors={activeErrors}
                competition={competition}
                change={<K extends keyof MatchDraft>(key: K, next: MatchDraft[K]) => {
                  if (key === 'community_id' && typeof next === 'string') selectCommunity(next);
                  else change(key, next);
                }}
              />
              <MatchPhotoUpload
                key={`${communityId}:${eventId}`}
                communityId={communityId}
                eventId={eventId}
                photo={photo}
                onChange={changePhoto}
                onBusyChange={setPhotoBusy}
                copying={photoCopyBusy}
                copyFailed={photoCopyError}
                invalid={Boolean(fieldErrors.photo)}
              />
            </>
          )}
          {step === 1 && (
            <>
              <MatchPlayersForm
                value={value}
                levelDefaults={options.level_defaults}
                errors={activeErrors}
                change={change}
              />
              <section aria-labelledby="match-invite-heading" {...stylex.props(s.fields)}>
                <span id="match-invite-heading" {...stylex.props(s.choiceLabel)}>
                  {t('matchCreate.fields.invitePlayers')}
                </span>
                <MatchInviteePicker
                  communityId={communityId}
                  selected={invitees}
                  onChange={(next) => {
                    if (frozen.current) frozen.current = null;
                    setInvitees(next);
                  }}
                />
              </section>
            </>
          )}
          {step === 2 && (
            <fieldset {...stylex.props(s.group)}>
              <legend {...stylex.props(s.legend)}>{t('matchCreate.helpers.teamMode')}</legend>
              <div {...stylex.props(s.segmented)}>
                {(['POST_MATCH_TEAMS', 'PREDEFINED_TEAMS'] as const).map((mode) => (
                  <label key={mode} {...stylex.props(stylex.defaultMarker(), s.segment)}>
                    <input
                      type="radio"
                      name="teamMode"
                      {...stylex.props(s.segmentInput)}
                      checked={(value.teamMode ?? 'POST_MATCH_TEAMS') === mode}
                      onChange={() => change('teamMode', mode)}
                    />
                    {t(`matches.teamMode.${mode}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {step === 3 && (
            <>
              <MatchReview
                value={{
                  ...value,
                  timezone,
                  cutoffInstant: cutoffInstant
                    ? `${dateFormatter.format(cutoffInstant)} · ${timezone}`
                    : ''
                }}
                photo={photo}
                count={invitees.length}
                competition={resolution}
              />
              {fieldErrors.cutoff && (
                <p {...stylex.props(s.formMessage)} role="alert">
                  {t(`matchCreate.errors.${fieldErrors.cutoff}`)}
                </p>
              )}
              <p {...stylex.props(s.muted)}>{t('matchCreate.helpers.invitesOnPublish')}</p>
            </>
          )}
          {error && (
            <p {...stylex.props(s.formMessage)} role="alert">
              {t(`matchCreate.errors.${error}`)}
            </p>
          )}
          {requiredInvalid && (
            <output aria-live="polite" {...stylex.props(s.formMessage)}>
              {t('matchCreate.errors.invalidInput')}
            </output>
          )}
        </div>
        <div {...stylex.props(s.actions)}>
          {step > 0 ? (
            <Button
              variant="secondary"
              xstyle={s.secondaryAction}
              onClick={() => setStep(step - 1)}
            >
              {t('matchCreate.previous')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              xstyle={s.secondaryAction}
              onClick={() => void navigate({ to: '/matches' })}
            >
              {t('matchCreate.cancel')}
            </Button>
          )}
          {step < 3 ? (
            <Button
              xstyle={s.primaryAction}
              onClick={() => {
                setError('');
                setStep(step + 1);
              }}
            >
              {t('matchCreate.next')}
            </Button>
          ) : (
            <Button
              xstyle={s.primaryAction}
              busy={busy}
              disabled={photoBusy || photoCopyBusy || !photo}
              onClick={() => void publish(Date.now())}
            >
              {t(busy ? 'matchCreate.publishing' : 'matchCreate.publish')}
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}

function BackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      {...stylex.props(s.backIcon)}
    >
      <path d="m14 6-6 6 6 6" />
    </svg>
  );
}
