import { Button } from '@base-ui/react/button';
import { NumberField } from '@base-ui/react/number-field';
import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchEventDetail } from './match-contracts';
import type { ManagementParticipant, MatchEventManagement } from './match-management-model';
import type { MatchRosterEntry } from './match-registration-model';
import type {
  MatchResultResponse,
  ResultProposal,
  ResultSetRow,
  ResultSubmission
} from './match-result-model';
import { matchResultActionError } from './match-result-model';
import { MATCH_RESULT_ERROR_COPY } from './match-result-error-copy';
import {
  MatchResultValidationError,
  classifyMatchResultSets,
  validateMatchResultSets
} from './match-result.validators';
import { resultGroupPlayers, resultOffsetLabel, resultPlayedOffsets } from './match-result-form';
import { submitMatchEventResult } from './match-result.functions';
import { MatchManagementUnavailable } from './MatchManagementUnavailable';
import { MatchResultPending } from './MatchResultPending';
import { matchResultStyles as s } from './match-result.styles';

type Props = {
  event: MatchEventDetail | null;
  management: MatchEventManagement | null;
  roster: MatchRosterEntry[];
  participants: ManagementParticipant[];
  proposals: ResultProposal[];
  loadError?: boolean;
  onReload: () => void;
  onSubmit?: (
    options: Parameters<typeof submitMatchEventResult>[0]
  ) => Promise<MatchResultResponse<ResultSubmission>>;
};
type Failure = Exclude<MatchResultResponse<ResultSubmission>, { status: 'ok' }>;
const sides = ['team_a', 'team_b'] as const;

export function RecordMatchResultPage(props: Props) {
  const { t } = useTranslation();
  const { event, management, roster, participants, proposals, onReload } = props;
  const groups = [
    ...new Set(roster.filter((p) => p.participation === 'playing').map((p) => p.group_number))
  ]
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const [group, setGroup] = useState(groups[0] ?? 1);
  if (!event || props.loadError)
    return (
      <main {...stylex.props(s.page)}>
        <p role="alert">{t('matches.results.errors.unavailable')}</p>
        <Button {...stylex.props(s.button)} onClick={onReload}>
          {t('matches.results.reload')}
        </Button>
      </main>
    );
  if (!management?.correction.available || event.status === 'cancelled')
    return (
      <main {...stylex.props(s.page)}>
        <MatchManagementUnavailable
          reason={
            event.status === 'cancelled'
              ? 'cancelled'
              : management?.correction.available === false &&
                  management.correction.reason === 'forbidden'
                ? 'forbidden'
                : 'unavailable'
          }
        />
        <Link
          to="/matches/$eventId"
          params={{ eventId: event.event_id }}
          {...stylex.props(s.button)}
        >
          {t('matches.management.unavailable.backToMatch')}
        </Link>
      </main>
    );
  const players = resultGroupPlayers(roster, participants, group);
  return (
    <main {...stylex.props(s.page)}>
      <h1 {...stylex.props(s.title)}>{t('matches.results.title')}</h1>
      <p {...stylex.props(s.copy)}>{event.venue_name}</p>
      <Link to="/matches/$eventId" params={{ eventId: event.event_id }} {...stylex.props(s.button)}>
        {t('matches.management.unavailable.backToMatch')}
      </Link>
      <label {...stylex.props(s.field)}>
        {t('matches.results.groupLabel')}
        <select
          {...stylex.props(s.input)}
          value={group}
          onChange={(e) => setGroup(Number(e.target.value))}
        >
          {groups.map((n) => (
            <option key={n} value={n}>
              {t('matches.results.group', { number: n })}
            </option>
          ))}
        </select>
      </label>
      {proposals.some((p) => p.group_number === group) ? (
        <MatchResultPending
          proposal={proposals.find((p) => p.group_number === group)!}
          timezone={event.timezone}
          asOf={event.as_of}
        />
      ) : players.length === 4 ? (
        <ResultForm key={group} {...props} event={event} group={group} players={players} />
      ) : (
        <p role="alert">{t('matches.results.errors.invalidGroup')}</p>
      )}
    </main>
  );
}

function ResultForm({
  event,
  group,
  players,
  onReload,
  onSubmit = submitMatchEventResult
}: Props & { event: MatchEventDetail; group: number; players: ManagementParticipant[] }) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [order, setOrder] = useState(() => players.map((p) => p.user_id));
  const [editing, setEditing] = useState(false);
  const [sets, setSets] = useState<ResultSetRow[]>([
    { position: 1, team_a_games: 0, team_b_games: 0, completed: false }
  ]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [offset, setOffset] = useState('');
  const [court, setCourt] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState<ResultSubmission | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const offsets = resultPlayedOffsets(date, time, event.timezone);
  const selectedOffset =
    offsets.length === 1
      ? offsets[0]
      : offset !== '' && offsets.includes(Number(offset))
        ? Number(offset)
        : undefined;
  let outcome: ReturnType<typeof classifyMatchResultSets> | null = null;
  try {
    outcome = classifyMatchResultSets(sets);
  } catch {
    /* In-progress edits are not a prediction. */
  }
  const blocked =
    failure?.status === 'conflict' ||
    (failure?.status === 'error' &&
      ['group_players', 'invalid_group', 'idempotency_conflict', 'cancelled', 'forbidden'].includes(
        failure.code
      ));
  function move(next: number) {
    setStep(next);
    setFailure(null);
    heading.current?.focus();
  }
  function showFailure(error: Failure) {
    setFailure(error);
    if (error.status === 'error') {
      if (error.detail?.set_index) setStep(1);
      if (['invalid_teams', 'duplicate_player', 'group_players'].includes(error.code)) {
        setStep(0);
        setEditing(true);
      }
    }
    heading.current?.focus();
  }
  function validateScore() {
    try {
      validateMatchResultSets(sets);
      if (selectedOffset === undefined) {
        showFailure({ status: 'error', code: 'invalid_played_at' });
        return;
      }
      move(2);
    } catch (error) {
      if (error instanceof MatchResultValidationError) {
        const result = matchResultActionError({
          message: error.message,
          details: JSON.stringify(error.detail)
        });
        if (result.status !== 'ok') showFailure(result);
      }
    }
  }
  async function submit() {
    if (inFlight.current || blocked || success) return;
    const facts = {
      event_id: event.event_id,
      group_number: group,
      teams: { team_a: [order[0] ?? '', order[1] ?? ''], team_b: [order[2] ?? '', order[3] ?? ''] },
      sets,
      played_local: {
        local: `${date} ${time.length === 5 ? `${time}:00` : time}`,
        offset_seconds: selectedOffset
      },
      court_label: court.trim() || null
    };
    const payload = JSON.stringify(facts);
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, id: crypto.randomUUID() };
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await onSubmit({ data: { ...facts, request_id: attempt.current.id } });
      if (result.status === 'ok') setSuccess(result.value);
      else showFailure(result);
    } catch {
      showFailure({ status: 'error', code: 'unavailable' });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  if (success)
    return (
      <MatchResultPending
        proposal={success}
        timezone={event.timezone}
        asOf={success.submitted_at}
      />
    );
  const errorText = failure ? t(MATCH_RESULT_ERROR_COPY[failure.code]) : '';
  const detail = failure?.status === 'error' ? failure.detail : undefined;
  function inlineError(index: number | null, side?: (typeof sides)[number]) {
    if (
      !failure ||
      failure.status !== 'error' ||
      detail?.set_index !== index ||
      (side && detail.side && detail.side !== side)
    )
      return null;
    return (
      <p
        id={index === null ? `team-error-${side}` : `set-error-${index}`}
        role="alert"
        {...stylex.props(s.error)}
      >
        {index === null
          ? t('matches.results.teamError', {
              team: detail.side ? t(`matches.results.teams.${detail.side}`) : '',
              message: errorText
            })
          : t('matches.results.setError', {
              number: index,
              team: detail.side ? t(`matches.results.teams.${detail.side}`) : '',
              message: errorText
            })}
      </p>
    );
  }
  return (
    <form
      {...stylex.props(s.field)}
      onSubmit={(e) => {
        e.preventDefault();
        if (step === 0) move(1);
        else if (step === 1) validateScore();
        else void submit();
      }}
    >
      <ol {...stylex.props(s.steps)}>
        {['players', 'score', 'review'].map((key, index) => (
          <li key={key} aria-current={step === index ? 'step' : undefined}>
            {t(`matches.results.steps.${key}`)} {index < step ? '✓' : index + 1}
          </li>
        ))}
      </ol>
      <h2 ref={heading} tabIndex={-1} {...stylex.props(s.heading)}>
        {t(
          step === 0
            ? 'matches.results.confirmPlayers'
            : step === 1
              ? 'matches.results.sets'
              : 'matches.results.preview'
        )}
      </h2>
      <fieldset disabled={pending || blocked} {...stylex.props(s.card)}>
        {(step === 0 || step === 2) && (
          <>
            {step === 0 && <p {...stylex.props(s.copy)}>{t('matches.results.suggested')}</p>}
            {sides.map((side, sideIndex) => (
              <section key={side} {...stylex.props(s.field)}>
                <h3 {...stylex.props(s.heading)}>{t(`matches.results.teams.${side}`)}</h3>
                <div {...stylex.props(s.row)}>
                  {[0, 1].map((seat) => {
                    const position = sideIndex * 2 + seat;
                    const name =
                      players.find((p) => p.user_id === order[position])?.display_name ??
                      t('matches.results.unknownPlayer');
                    return editing && step === 0 ? (
                      <label key={seat} {...stylex.props(s.field)}>
                        {t('matches.results.playerSlot', {
                          team: t(`matches.results.teams.${side}`),
                          number: seat + 1
                        })}
                        <select
                          {...stylex.props(s.input)}
                          value={order[position]}
                          aria-invalid={detail?.set_index === null && detail.side === side}
                          aria-describedby={
                            detail?.set_index === null && detail.side === side
                              ? `team-error-${side}`
                              : undefined
                          }
                          onChange={(e) => {
                            const next = [...order];
                            const other = next.indexOf(e.target.value);
                            [next[position], next[other]] = [next[other]!, next[position]!];
                            setOrder(next);
                            setFailure(null);
                          }}
                        >
                          {players.map((p) => (
                            <option key={p.user_id} value={p.user_id}>
                              {p.display_name ?? t('matches.results.unknownPlayer')}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <span key={seat} {...stylex.props(s.chip)}>
                        {name}
                      </span>
                    );
                  })}
                </div>
                {inlineError(null, side)}
              </section>
            ))}
            {step === 0 && (
              <Button
                type="button"
                {...stylex.props(s.button)}
                aria-expanded={editing}
                onClick={() => setEditing(!editing)}
              >
                {t('matches.results.changeTeams')}
              </Button>
            )}
          </>
        )}
        {step === 1 && (
          <>
            {sets.map((set, index) => (
              <fieldset
                key={set.position}
                {...stylex.props(s.setRow)}
                aria-describedby={
                  detail?.set_index === set.position ? `set-error-${set.position}` : undefined
                }
              >
                <legend>{t('matches.results.setNumber', { number: set.position })}</legend>
                <div {...stylex.props(s.scores)}>
                  {sides.map((side) => (
                    <NumberField.Root
                      key={side}
                      min={0}
                      max={7}
                      step={1}
                      value={set[`${side}_games`]}
                      onValueChange={(value) => {
                        setSets(
                          sets.map((row, i) =>
                            i === index ? { ...row, [`${side}_games`]: value ?? 0 } : row
                          )
                        );
                        setFailure(null);
                      }}
                    >
                      <label htmlFor={`score-${index}-${side}`}>
                        {t(`matches.results.teams.${side}`)}
                      </label>
                      <NumberField.Group {...stylex.props(s.stepper)}>
                        <NumberField.Decrement
                          {...stylex.props(s.button)}
                          aria-label={t('matches.results.decrease', {
                            number: set.position,
                            team: t(`matches.results.teams.${side}`)
                          })}
                        >
                          −
                        </NumberField.Decrement>
                        <NumberField.Input
                          id={`score-${index}-${side}`}
                          {...stylex.props(s.number)}
                          aria-invalid={
                            detail?.set_index === set.position &&
                            (detail.side === side || detail.side === null)
                          }
                          aria-describedby={
                            detail?.set_index === set.position
                              ? `set-error-${set.position}`
                              : undefined
                          }
                        />
                        <NumberField.Increment
                          {...stylex.props(s.button)}
                          aria-label={t('matches.results.increase', {
                            number: set.position,
                            team: t(`matches.results.teams.${side}`)
                          })}
                        >
                          +
                        </NumberField.Increment>
                      </NumberField.Group>
                    </NumberField.Root>
                  ))}
                </div>
                <Button
                  type="button"
                  {...stylex.props(s.button, set.completed && s.positive)}
                  aria-pressed={set.completed}
                  aria-label={t('matches.results.setStateLabel', { number: set.position })}
                  onClick={() => {
                    setSets(
                      sets.map((row, i) =>
                        i === index ? { ...row, completed: !row.completed } : row
                      )
                    );
                    setFailure(null);
                  }}
                >
                  {t(
                    set.completed
                      ? 'matches.results.setState.complete'
                      : 'matches.results.setState.inProgress'
                  )}
                </Button>
                {inlineError(set.position)}
              </fieldset>
            ))}
            <div {...stylex.props(s.row)}>
              <Button
                type="button"
                {...stylex.props(s.button)}
                disabled={sets.length >= 3 || !sets.at(-1)?.completed}
                onClick={() =>
                  setSets([
                    ...sets,
                    {
                      position: sets.length + 1,
                      team_a_games: 0,
                      team_b_games: 0,
                      completed: false
                    }
                  ])
                }
              >
                {t('matches.results.addSet')}
              </Button>
              <Button
                type="button"
                {...stylex.props(s.button)}
                disabled={sets.length <= 1}
                onClick={() => {
                  setSets(sets.slice(0, -1));
                  setFailure(null);
                }}
              >
                {t('matches.results.removeSet')}
              </Button>
            </div>
            <p {...stylex.props(s.copy)}>{t('matches.results.scoreHelp')}</p>
            <label {...stylex.props(s.field)}>
              {t('matches.results.playedAt', { timezone: event.timezone })}
              <input
                {...stylex.props(s.input)}
                type="date"
                required
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setOffset('');
                  setFailure(null);
                }}
              />
            </label>
            <label {...stylex.props(s.field)}>
              {t('matches.results.playedTime')}
              <input
                {...stylex.props(s.input)}
                type="time"
                required
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setOffset('');
                  setFailure(null);
                }}
              />
            </label>
            {offsets.length > 1 && (
              <label {...stylex.props(s.field)}>
                {t('matches.results.playedAtOffset')}
                <select
                  {...stylex.props(s.input)}
                  required
                  value={offset}
                  onChange={(e) => setOffset(e.target.value)}
                >
                  <option value="">{t('matches.results.chooseOffset')}</option>
                  {offsets.map((n) => (
                    <option key={n} value={n}>
                      {resultOffsetLabel(n)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label {...stylex.props(s.field)}>
              {t('matches.results.courtLabel')}
              <input
                {...stylex.props(s.input)}
                maxLength={100}
                value={court}
                onChange={(e) => setCourt(e.target.value)}
              />
            </label>
          </>
        )}
        {step === 2 && (
          <section {...stylex.props(s.card)}>
            <p>{t('matches.results.group', { number: group })}</p>
            <p>
              {t('matches.results.playedAt', { timezone: event.timezone })}: {date} {time}{' '}
              {resultOffsetLabel(selectedOffset ?? 0)}
            </p>
            <p>
              {t('matches.results.courtLabel')}: {court || t('matches.results.notProvided')}
            </p>
            {sets.map((set) => (
              <p key={set.position}>
                {t('matches.results.setNumber', { number: set.position })}: {set.team_a_games} —{' '}
                {set.team_b_games} ·{' '}
                {t(
                  set.completed
                    ? 'matches.results.setState.complete'
                    : 'matches.results.setState.inProgress'
                )}
              </p>
            ))}
          </section>
        )}
        {step > 0 && (
          <section {...stylex.props(s.card)} aria-live="polite" aria-atomic="true">
            <h3 {...stylex.props(s.heading)}>{t('matches.results.outcomeLabel')}</h3>
            <p {...stylex.props(s.heading)}>
              {t(
                outcome ? `matches.results.outcome.${outcome}` : 'matches.results.outcome.invalid'
              )}
            </p>
            {outcome && (
              <p {...stylex.props(s.copy)}>{t(`matches.results.outcomeHelper.${outcome}`)}</p>
            )}
            <p {...stylex.props(s.positive)}>
              {t(
                event.event_type === 'competitive' && outcome && outcome !== 'incomplete'
                  ? 'matches.results.ratingEffect'
                  : event.event_type === 'friendly'
                    ? 'matches.results.ratingEffectNone'
                    : 'matches.results.ratingEffectIncomplete'
              )}
            </p>
          </section>
        )}
      </fieldset>
      <output aria-live="polite" aria-atomic="true">
        {pending ? t('matches.results.submitting') : errorText}
      </output>
      {failure?.status === 'conflict' && (
        <p>
          {t('matches.results.versionLabel', { version: failure.active_version })} ·{' '}
          {t('matches.results.reviewDeadline', {
            deadline: new Intl.DateTimeFormat(i18n.language, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: event.timezone
            }).format(new Date(failure.review_deadline_at))
          })}
        </p>
      )}
      {blocked ? (
        <Button type="button" {...stylex.props(s.button)} onClick={onReload}>
          {t('matches.results.reload')}
        </Button>
      ) : (
        <>
          {step > 0 && (
            <Button
              type="button"
              disabled={pending}
              {...stylex.props(s.button)}
              onClick={() => move(step - 1)}
            >
              {t('matches.results.back')}
            </Button>
          )}
          <Button type="submit" disabled={pending} {...stylex.props(s.button, s.primary)}>
            {t(
              pending
                ? 'matches.results.submitting'
                : step === 0
                  ? 'matches.results.confirmTeams'
                  : step === 1
                    ? 'matches.results.review'
                    : 'matches.results.submit'
            )}
          </Button>
        </>
      )}
    </form>
  );
}
