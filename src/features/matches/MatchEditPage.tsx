import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { TopBar } from '../../components/ui/TopBar';
import type { MatchEventDetail, MatchLeagueOption } from './match-contracts';
import { MatchDetailTextField, MatchDetailCurrencyField } from './MatchDetailsForm';
import { matchEditDraft, type MatchEditDraft } from './match-management-edit';
import { validateMatchEditDraft } from './match-management.validators';
import { useMatchEdit } from './use-match-edit';
import { useMatchLeagueOptions } from './use-match-league-options';
import { resolveMatchEditCompetition, formatMatchLeaguePeriod } from './match-league-selection';
import type { MatchCompetitionSide } from './match-consent-change';
import { competitionEffect, competitionImpactWindow } from './match-consent-change';
import { MatchEditCompetitionField } from './MatchEditCompetitionField';
import { MatchLeagueImpact } from './MatchLeagueImpact';
import { matchManagementStyles as s } from './match-management.styles';
import { matchEditStyles as edit } from './match-edit.styles';
import { createMatchStyles as page } from './create-match.styles';
import { MatchManagementUnavailable } from './MatchManagementUnavailable';

/** The bound League stays selectable even if the options reader no longer lists it. */
function withCurrentLeague(event: MatchEventDetail, leagues: MatchLeagueOption[]) {
  const { league_id: id, league_name: name, league_start_date: start } = event;
  if (!id || !name || !start || leagues.some((league) => league.id === id)) return leagues;
  const end = event.league_end_date ?? null;
  return [
    {
      id,
      name,
      status: 'active' as const,
      end_mode: end ? ('fixed_date' as const) : ('manual' as const),
      timezone: event.timezone,
      start_at: '',
      end_at: null,
      start_date: start,
      end_date: end
    },
    ...leagues
  ];
}

/** Mount per explicit open, not per loader version: conflicts must retain drafts. */
export function MatchEditPage({
  event,
  version,
  onClose
}: {
  event: MatchEventDetail;
  version: number;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [snapshot] = useState(() => ({ event, version }));
  const [original] = useState(() => matchEditDraft(event));
  const [draft, setDraft] = useState(original);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const action = useMatchEdit(snapshot.event.event_id, snapshot.version);
  const competitive = draft.eventType === 'competitive';
  const options = useMatchLeagueOptions(snapshot.event, draft.startsAt, competitive);
  const candidates = withCurrentLeague(snapshot.event, options.leagues);
  const resolution = resolveMatchEditCompetition(
    draft.competitionChoice,
    draft.leagueId,
    candidates
  );
  const side = (league: MatchLeagueOption | null, status: MatchCompetitionSide['status']) => ({
    status,
    leagueId: league?.id ?? null,
    leagueName: league?.name ?? null,
    window: league ? { start_date: league.start_date, end_date: league.end_date } : null
  });
  const before: MatchCompetitionSide = {
    status: snapshot.event.competition_status,
    leagueId: snapshot.event.league_id,
    leagueName: snapshot.event.league_name,
    window: snapshot.event.league_start_date
      ? {
          start_date: snapshot.event.league_start_date,
          end_date: snapshot.event.league_end_date ?? null
        }
      : null
  };
  const after = side(
    competitive ? resolution.league : null,
    competitive ? resolution.competition : null
  );
  const rankedWithoutLeague =
    competitive && resolution.competition === 'ranked' && resolution.league === null;
  const impact = !rankedWithoutLeague && competitionEffect(before, after) !== 'unchanged';
  const major =
    impact || draft.eventType !== original.eventType || draft.startsAt !== original.startsAt;
  // Ranked intent with no usable League while the options are loading or failed: hold the save
  // (the reason is shown next to it). An invalid date is not held; submitting reports it.
  const competitionUnresolved =
    rankedWithoutLeague && (options.status === 'loading' || options.status === 'error');
  const rejectionWindow = competitionImpactWindow(action.rejection?.detail?.league ?? null);
  // Entering the flow lands on its heading, like the other page flows.
  useEffect(() => heading.current?.focus(), []);
  const change = <K extends keyof MatchEditDraft>(key: K, value: MatchEditDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors({});
    action.clearRejection();
  };
  async function submit(next: MatchEditDraft) {
    if (action.pending || action.conflict || saved || competitionUnresolved) return;
    const effective = resolveMatchEditCompetition(
      next.competitionChoice,
      next.leagueId,
      candidates
    );
    const { patch, errors: found } = validateMatchEditDraft(
      {
        ...next,
        competitionChoice: effective.competition,
        leagueId: effective.league?.id ?? ''
      },
      snapshot.event,
      snapshot.version
    );
    setErrors(found);
    if (Object.keys(found).length) {
      // Error DOM renders before focus; no automatic consent/version rebasing.
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
      );
      return;
    }
    if (await action.save(patch)) setSaved(true);
  }
  const field = (
    name: Exclude<
      keyof MatchEditDraft,
      'currency' | 'eventType' | 'competitionChoice' | 'leagueId'
    >,
    type: 'text' | 'url' | 'number' | 'datetime-local' = 'text'
  ) => (
    <MatchDetailTextField
      key={name}
      name={name}
      value={draft[name]}
      onChange={(value) => change(name, value)}
      type={type}
      error={errors[name]}
      fieldStyle={edit.field}
      inputStyle={edit.input}
      placeholder={name === 'notes' ? t('matchCreate.helpers.optional') : undefined}
      constraints={
        type === 'number'
          ? { min: name === 'price' ? 0 : 1, step: name === 'price' ? '0.01' : 1 }
          : type === 'datetime-local'
            ? { step: 1 }
            : {}
      }
    />
  );
  const busy = action.pending;
  const blocked = busy || action.conflict || saved || !!action.unavailable || competitionUnresolved;
  return (
    <main data-route-chrome="navigation" {...stylex.props(page.page)}>
      <TopBar
        headingId="match-edit-heading"
        headingRef={heading}
        title={t('matches.management.edit.title')}
        backAction={{ label: t('matches.management.close'), onClick: onClose, disabled: busy }}
      />
      <form
        ref={form}
        noValidate
        {...stylex.props(page.form)}
        onSubmit={async (e) => {
          e.preventDefault();
          await submit(draft);
        }}
      >
        <div {...stylex.props(page.content)}>
          <p {...stylex.props(edit.copy)}>
            {t(
              major && snapshot.event.accepted_count > 0
                ? 'matches.reconfirmation.description'
                : 'matches.management.edit.minorNotice'
            )}
          </p>
          {major && (
            <section {...stylex.props(edit.conflict)} aria-labelledby="match-edit-review-heading">
              <h2 id="match-edit-review-heading" {...stylex.props(edit.conflictHeading)}>
                {t('matches.management.edit.reviewMajor')}
              </h2>
              <p {...stylex.props(edit.copy)}>
                {t('matches.management.edit.changeSummary', {
                  before: `${t(`matches.type.${original.eventType}`)} · ${original.startsAt.replace('T', ' ')}`,
                  after: `${t(`matches.type.${draft.eventType}`)} · ${draft.startsAt.replace('T', ' ')}`
                })}
              </p>
              {impact && <MatchLeagueImpact from={before} to={after} />}
            </section>
          )}
          {action.unavailable && (
            <MatchManagementUnavailable reason={action.unavailable} onBack={onClose} focus />
          )}
          {action.conflict && (
            <section role="alert" {...stylex.props(edit.conflict)}>
              <h2 {...stylex.props(edit.conflictHeading)}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  {...stylex.props(edit.warningIcon)}
                >
                  <path d="m10 4-8 14a2 2 0 0 0 2 3h16a2 2 0 0 0 2-3L14 4a2 2 0 0 0-4 0Z" />
                  <path d="M12 8v6m0 3v1" />
                </svg>
                {t('matches.management.edit.conflictTitle')}
              </h2>
              <p {...stylex.props(edit.copy)}>{t('matches.management.edit.conflictDescription')}</p>
              <div {...stylex.props(edit.columns)}>
                <button
                  type="button"
                  {...stylex.props(s.button, edit.button)}
                  disabled={action.pending}
                  onClick={async () => {
                    if (await action.reload()) onClose();
                  }}
                >
                  {t('matches.management.edit.reload')}
                </button>
                <button
                  type="button"
                  {...stylex.props(s.button, edit.button, edit.primary)}
                  onClick={() => form.current?.querySelector<HTMLInputElement>('input')?.focus()}
                >
                  {t('matches.management.edit.reviewDraft')}
                </button>
              </div>
            </section>
          )}
          {action.rejection && (
            <section role="alert" {...stylex.props(edit.conflict)}>
              <h2 {...stylex.props(edit.conflictHeading)}>
                {t(`matches.management.edit.rejection.${action.rejection.code}.title`)}
              </h2>
              <p {...stylex.props(edit.copy)}>
                {t(`matches.management.edit.rejection.${action.rejection.code}.description`, {
                  league: action.rejection.detail?.league?.league_name ?? '',
                  period: rejectionWindow
                    ? formatMatchLeaguePeriod(rejectionWindow, i18n.language)
                    : '',
                  count: action.rejection.detail?.accepted_nonmember_count ?? 0
                })}
              </p>
              {action.rejection.code === 'league_out_of_period' && (
                <div {...stylex.props(edit.columns)}>
                  <button
                    type="button"
                    {...stylex.props(s.button, edit.button)}
                    onClick={() =>
                      form.current
                        ?.querySelector<HTMLInputElement>('input[type="datetime-local"]')
                        ?.focus()
                    }
                  >
                    {t('matches.management.edit.rejection.adjustDate')}
                  </button>
                  <button
                    type="button"
                    {...stylex.props(s.button, edit.button, edit.primary)}
                    disabled={action.pending}
                    onClick={() => {
                      const next = { ...draft, competitionChoice: 'unranked' as const };
                      setDraft(next);
                      void submit(next);
                    }}
                  >
                    {t('matches.management.edit.rejection.saveUnranked')}
                  </button>
                </div>
              )}
              {action.rejection.code === 'ranked_nonmembers_accepted' && (
                <button
                  type="button"
                  {...stylex.props(s.button, edit.button)}
                  onClick={() => change('competitionChoice', 'unranked')}
                >
                  {t('matches.management.edit.rejection.keepUnranked')}
                </button>
              )}
            </section>
          )}
          <fieldset
            disabled={action.pending || saved || !!action.unavailable}
            {...stylex.props(edit.fields)}
          >
            <label {...stylex.props(edit.field)}>
              {t('matchCreate.fields.type')}
              <select
                value={draft.eventType}
                onChange={(e) =>
                  change('eventType', e.target.value === 'competitive' ? 'competitive' : 'friendly')
                }
                {...stylex.props(s.input, edit.input)}
              >
                <option value="friendly">{t('matches.type.friendly')}</option>
                <option value="competitive">{t('matches.type.competitive')}</option>
              </select>
            </label>
            {field('startsAt', 'datetime-local')}
            {competitive && (
              <MatchEditCompetitionField
                competition={{
                  status: options.status,
                  candidates,
                  resolution,
                  retry: options.retry
                }}
                change={change}
                error={errors.leagueId}
              />
            )}
            {impact && snapshot.event.accepted_count > 0 && (
              <p {...stylex.props(edit.helper)}>
                {t('matches.management.edit.competitionConsent')}
              </p>
            )}
            {field('venueName')}
            {field('mapsUrl', 'url')}
            {field('courtNotes')}
            <div {...stylex.props(edit.columns)}>
              {field('price', 'number')}
              <MatchDetailCurrencyField
                value={draft.currency}
                onChange={(value) => change('currency', value)}
                error={errors.currency}
                fieldStyle={edit.field}
                inputStyle={edit.input}
              />
            </div>
            {field('paymentNote')}
            {field('notes')}
            {field('maximumRegistrations', 'number')}
            {field('cutoff', 'datetime-local')}
          </fieldset>

          {action.conflict && (
            <p {...stylex.props(edit.helper)}>{t('matches.management.edit.conflictHelper')}</p>
          )}
          {action.feedback && <output aria-live="polite">{t(action.feedback)}</output>}
          {competitionUnresolved && (
            <p id="match-edit-save-blocked" {...stylex.props(edit.helper)}>
              {t('matches.management.edit.competition.saveBlocked')}
            </p>
          )}
        </div>
        <div {...stylex.props(page.actions)}>
          <Button
            variant="secondary"
            xstyle={page.secondaryAction}
            disabled={busy}
            onClick={onClose}
          >
            {t('matches.management.cancel')}
          </Button>
          <Button
            type="submit"
            xstyle={page.primaryAction}
            busy={busy}
            disabled={blocked}
            aria-describedby={competitionUnresolved ? 'match-edit-save-blocked' : undefined}
          >
            {t('matches.management.edit.save')}
          </Button>
        </div>
      </form>
    </main>
  );
}
