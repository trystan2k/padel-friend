import { AlertDialog } from '@base-ui/react/alert-dialog';
import * as stylex from '@stylexjs/stylex';
import { Link, useRouter } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { rootStyles } from '../../root.styles';
import type {
  LeagueCountersResult,
  LeagueDetailResult,
  LeagueDto,
  LeagueErrorCode,
  UpdateLeagueChanges
} from './league-contracts';
import { leagueErrorCode } from './league-errors';
import {
  formatLeagueInstant,
  leagueFormValuesFromLeague,
  todayInZone,
  type LeagueFormInput
} from './league-form';
import { activateLeague, closeLeague, updateLeague } from './league.functions';
import { LeagueCounters, LeagueCountersUnavailable } from './LeagueCounters';
import { LeagueForm } from './LeagueForm';
import { LeagueStatusBadge, useLeaguePeriodText } from './LeagueSummary';
import { styles } from './league.styles';

type Feedback = { kind: 'success'; key: string } | { kind: 'error'; code: LeagueErrorCode } | null;

/** Only the fields that differ from the stored League, so a rename never touches the period. */
function changesFrom(league: LeagueDto, input: LeagueFormInput): UpdateLeagueChanges {
  const changes: UpdateLeagueChanges = {};
  if (input.name !== league.name) changes.name = input.name;
  if (input.description !== league.description) changes.description = input.description;
  if (input.minimum_matches !== league.minimum_matches_for_final_award)
    changes.minimum_matches_for_final_award = input.minimum_matches;
  if (
    input.end_mode !== league.end_mode ||
    input.start_date !== league.start_date ||
    input.end_date !== league.end_date
  ) {
    if (input.end_mode !== league.end_mode) changes.end_mode = input.end_mode;
    if (input.start_date !== league.start_date) changes.start_date = input.start_date;
    if (input.end_date !== league.end_date) changes.end_date = input.end_date;
  }
  return changes;
}

export function LeagueDetailPage({
  data,
  counters
}: {
  data: LeagueDetailResult;
  /** Null when the counter reader was unavailable: the page stays usable and offers a retry. */
  counters: LeagueCountersResult | null;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { community } = data;
  // The latest command result wins until a refreshed loader brings a version at least as new.
  const [result, setResult] = useState<LeagueDto | null>(null);
  const league = result && result.version >= data.league.version ? result : data.league;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [retryingCounters, setRetryingCounters] = useState(false);
  const closeTrigger = useRef<HTMLButtonElement>(null);
  const period = useLeaguePeriodText(league);

  const canActivate =
    league.can_manage &&
    league.status === 'upcoming' &&
    (league.blocked_reason !== null || league.activation_due);
  const canClose = league.can_manage && league.status === 'active' && league.end_mode === 'manual';
  const canEdit = league.can_manage && league.status !== 'closed';

  const run = async (command: () => Promise<LeagueDto>, success: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setFeedback(null);
    try {
      setResult(await command());
      setFeedback({ kind: 'success', key: success });
      void router.invalidate();
      return true;
    } catch (error) {
      const code = leagueErrorCode(error);
      setFeedback({ kind: 'error', code });
      if (code === 'LEAGUE_VERSION_CONFLICT') void router.invalidate();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (input: LeagueFormInput): Promise<LeagueErrorCode | null> => {
    const changes = changesFrom(league, input);
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return null;
    }
    try {
      setResult(
        await updateLeague({
          data: { league_id: league.id, expected_version: league.version, changes }
        })
      );
      setEditing(false);
      setFeedback({ kind: 'success', key: 'leagues.detail.saved' });
      void router.invalidate();
      return null;
    } catch (error) {
      const code = leagueErrorCode(error);
      if (code === 'LEAGUE_VERSION_CONFLICT') void router.invalidate();
      return code;
    }
  };

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header, rootStyles.pageHeader)}>
        <div {...stylex.props(styles.headingRow)}>
          <Link
            to="/community/$communityId/leagues"
            params={{ communityId: community.id }}
            aria-label={t('leagues.back')}
            {...stylex.props(styles.backLink)}
          >
            <span aria-hidden="true">‹</span>
          </Link>
          <h1 id="league-heading" {...stylex.props(styles.title)}>
            {league.name}
          </h1>
        </div>
        <p {...stylex.props(styles.context)}>
          {t('leagues.communityContext', { community: community.name })}
        </p>
      </header>

      <div {...stylex.props(styles.content)}>
        <output
          aria-live="polite"
          {...stylex.props(feedback?.kind === 'success' && styles.successText)}
        >
          {feedback?.kind === 'success' ? t(feedback.key) : null}
        </output>
        {feedback?.kind === 'error' && (
          <p role="alert" {...stylex.props(styles.errorText)}>
            {t(`leagues.errors.${feedback.code}`)}
          </p>
        )}

        <SurfaceCard xstyle={styles.card}>
          <div {...stylex.props(styles.itemHeader)}>
            <LeagueStatusBadge status={league.status} />
            <span {...stylex.props(styles.muted)}>{period}</span>
          </div>
          {league.blocked_reason && (
            <p {...stylex.props(styles.blocked)}>{t(`leagues.blocked.${league.blocked_reason}`)}</p>
          )}
          {league.description && <p {...stylex.props(styles.text)}>{league.description}</p>}
          <dl {...stylex.props(styles.details)}>
            <dt {...stylex.props(styles.detailLabel)}>{t('leagues.detail.owner')}</dt>
            <dd {...stylex.props(styles.detailValue)}>
              {league.owner_name ?? t('leagues.detail.ownerUnknown')}
            </dd>
            <dt {...stylex.props(styles.detailLabel)}>{t('leagues.detail.timezone')}</dt>
            <dd {...stylex.props(styles.detailValue)}>{league.timezone}</dd>
            <dt {...stylex.props(styles.detailLabel)}>{t('leagues.detail.minimum')}</dt>
            <dd {...stylex.props(styles.detailValue)}>{league.minimum_matches_for_final_award}</dd>
            {league.closed_at && league.closed_reason && (
              <>
                <dt {...stylex.props(styles.detailLabel)}>{t('leagues.detail.closed')}</dt>
                <dd {...stylex.props(styles.detailValue)}>
                  {formatLeagueInstant(league.closed_at, i18n.language, league.timezone)} ·{' '}
                  {t(`leagues.detail.closedReason.${league.closed_reason}`)}
                </dd>
              </>
            )}
          </dl>
        </SurfaceCard>

        {counters ? (
          <LeagueCounters counters={counters} />
        ) : (
          <LeagueCountersUnavailable
            busy={retryingCounters}
            onRetry={() => {
              setRetryingCounters(true);
              void router.invalidate().finally(() => setRetryingCounters(false));
            }}
          />
        )}

        {(canActivate || canClose || canEdit) && !editing && (
          <div {...stylex.props(styles.actions)}>
            {canActivate && (
              <Button
                busy={busy}
                onClick={() =>
                  void run(
                    () =>
                      activateLeague({
                        data: { league_id: league.id, expected_version: league.version }
                      }),
                    'leagues.detail.activated'
                  )
                }
              >
                {t('leagues.detail.activate')}
              </Button>
            )}
            {canClose && (
              <Button
                ref={closeTrigger}
                variant="secondary"
                disabled={busy}
                onClick={() => setCloseOpen(true)}
              >
                {t('leagues.detail.close')}
              </Button>
            )}
            {canEdit && (
              <Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
                {t('leagues.detail.edit')}
              </Button>
            )}
          </div>
        )}
        {canActivate && league.blocked_reason === 'active_league_exists' && (
          <p {...stylex.props(styles.muted)}>{t('leagues.detail.activateHint')}</p>
        )}

        {editing && (
          <section aria-labelledby="league-edit-heading" {...stylex.props(styles.content)}>
            <h2 id="league-edit-heading" {...stylex.props(styles.sectionTitle)}>
              {t('leagues.detail.edit')}
            </h2>
            <LeagueForm
              initialValues={leagueFormValuesFromLeague(league)}
              today={todayInZone(league.timezone)}
              originalStartDate={league.start_date}
              periodLocked={league.period_locked}
              startLocked={league.status === 'active'}
              submitLabel={t('leagues.detail.save')}
              submittingLabel={t('leagues.detail.saving')}
              onSubmit={save}
            />
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
              {t('leagues.detail.cancelEdit')}
            </Button>
          </section>
        )}
      </div>

      <AlertDialog.Root open={closeOpen} onOpenChange={(open) => !busy && setCloseOpen(open)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop {...stylex.props(styles.dialogBackdrop)} />
          <AlertDialog.Viewport {...stylex.props(styles.dialogViewport)}>
            <AlertDialog.Popup finalFocus={closeTrigger} {...stylex.props(styles.dialog)}>
              <AlertDialog.Title {...stylex.props(styles.dialogTitle)}>
                {t('leagues.detail.closeConfirm.title', { name: league.name })}
              </AlertDialog.Title>
              <AlertDialog.Description {...stylex.props(styles.text)}>
                {t('leagues.detail.closeConfirm.body')}
              </AlertDialog.Description>
              {feedback?.kind === 'error' && (
                <p role="alert" {...stylex.props(styles.errorText)}>
                  {t(`leagues.errors.${feedback.code}`)}
                </p>
              )}
              <div {...stylex.props(styles.actions)}>
                <AlertDialog.Close
                  disabled={busy}
                  render={
                    <Button variant="secondary">{t('leagues.detail.closeConfirm.cancel')}</Button>
                  }
                />
                <Button
                  busy={busy}
                  onClick={async () => {
                    const closed = await run(
                      () =>
                        closeLeague({
                          data: { league_id: league.id, expected_version: league.version }
                        }),
                      'leagues.detail.closedDone'
                    );
                    if (closed) setCloseOpen(false);
                  }}
                >
                  {t('leagues.detail.closeConfirm.confirm')}
                </Button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </main>
  );
}
