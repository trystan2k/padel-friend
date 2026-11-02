import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type { LeagueDto } from './league-contracts';
import { formatLeagueInstant } from './league-form';
import type {
  LeagueFinalStandings,
  LeagueStandingsAuditResult,
  LeagueStandingsVersionSummary,
  LeagueStandingsVersionsResult
} from './league-standings-contracts';
import { getLeagueStandingsAudit, listLeagueStandingsVersions } from './league.functions';
import { styles as leagueStyles } from './league.styles';
import { styles } from './league-standings.styles';

/** What the loader handed down; recovered data is only valid while all of it is unchanged. */
type Generation = {
  leagueId: string;
  standings: LeagueFinalStandings;
  loadedVersions: LeagueStandingsVersionsResult | null;
  loadedAudit: LeagueStandingsAuditResult | null;
  auditFailed: boolean;
};
type Recovered = Generation & {
  versions: LeagueStandingsVersionsResult | null;
  audit: LeagueStandingsAuditResult | null;
};
const sameGeneration = (a: Generation, b: Generation) =>
  a.leagueId === b.leagueId &&
  a.standings === b.standings &&
  a.loadedVersions === b.loadedVersions &&
  a.loadedAudit === b.loadedAudit &&
  a.auditFailed === b.auditFailed;

/**
 * Inspect every published final of a closed League: pick a version, see why it exists (including
 * a first result confirmed after the close) and, for owner/Admin, the lifecycle audit trail.
 */
export function LeagueStandingsHistory({
  league,
  standings,
  versions: loadedVersions,
  audit: loadedAudit,
  auditFailed,
  onSelect
}: {
  league: LeagueDto;
  standings: LeagueFinalStandings;
  /** Null when the history reader was unavailable; the shown version stays usable. */
  versions: LeagueStandingsVersionsResult | null;
  audit: LeagueStandingsAuditResult | null;
  /** The owner/Admin audit read failed: retryable, as opposed to a viewer who may not see it. */
  auditFailed: boolean;
  /** `null` selects the latest version. */
  onSelect: (version: number | null) => void;
}) {
  const { t, i18n } = useTranslation();
  // Continuation pages belong to the first page they continue; a reloaded history starts over.
  const [more, setMore] = useState<{
    base: LeagueStandingsVersionsResult;
    items: LeagueStandingsVersionSummary[];
    next: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Retries read only the failed part, so the snapshot on screen is never discarded or reloaded.
  // Recovered data is valid only for the League and loader generation it was fetched for.
  const generation: Generation = {
    leagueId: league.id,
    standings,
    loadedVersions,
    loadedAudit,
    auditFailed
  };
  const latestGeneration = useRef(generation);
  useEffect(() => {
    latestGeneration.current = generation;
  });
  const [recovered, setRecovered] = useState<Recovered | null>(null);
  const [retrying, setRetrying] = useState<'versions' | 'audit' | null>(null);
  const focusAfterRetry = useRef<'versions' | 'audit' | null>(null);
  const completion = useRef<HTMLOutputElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const versionSelect = useRef<HTMLSelectElement>(null);
  const auditHeading = useRef<HTMLHeadingElement>(null);
  const current = recovered && sameGeneration(recovered, generation) ? recovered : null;
  const versions = loadedVersions ?? current?.versions ?? null;
  const audit = loadedAudit ?? current?.audit ?? null;
  const continued = versions && more?.base === versions ? more : null;
  // The completion belongs to the first page it continues; a replaced base page starts over.
  const loadedAll = continued !== null && continued.next === null;
  // The "load earlier" button unmounts with the last page: hand focus to the completion status.
  useEffect(() => {
    if (loadedAll) completion.current?.focus();
  }, [loadedAll]);
  // The focused retry button unmounts on success: hand focus to the recovered content.
  useEffect(() => {
    const part = focusAfterRetry.current;
    if (!part) return;
    focusAfterRetry.current = null;
    (part === 'versions'
      ? versionSelect.current
      : (auditHeading.current ?? historyHeading.current)
    )?.focus();
  });
  const items = [...(versions?.versions ?? []), ...(continued?.items ?? [])];
  const next = continued ? continued.next : (versions?.next_before_version ?? null);
  const selected = items.find((item) => item.standings_version === standings.standings_version);
  const when = (iso: string) => formatLeagueInstant(iso, i18n.language, league.timezone);
  const label = (version: number) =>
    version === standings.latest_standings_version
      ? `${t('leagues.history.versionLabel', { version })} · ${t('leagues.history.latest')}`
      : t('leagues.history.versionLabel', { version });

  const loadMore = async () => {
    if (!versions || next === null || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const page = await listLeagueStandingsVersions({
        data: { league_id: league.id, before_version: next }
      });
      setMore({
        base: versions,
        items: [...(continued?.items ?? []), ...page.versions],
        next: page.next_before_version
      });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const retry = async (part: 'versions' | 'audit') => {
    if (retrying) return;
    setRetrying(part);
    const requested = generation;
    try {
      const result =
        part === 'versions'
          ? {
              versions: await listLeagueStandingsVersions({
                data: { league_id: league.id, before_version: null }
              })
            }
          : { audit: await getLeagueStandingsAudit({ data: { league_id: league.id } }) };
      // A completion that outlived its League or loader generation neither recovers nor moves focus.
      if (!sameGeneration(latestGeneration.current, requested)) return;
      focusAfterRetry.current = part;
      setRecovered((previous) => ({
        versions: null,
        audit: null,
        ...(previous && sameGeneration(previous, requested) ? previous : null),
        ...requested,
        ...result
      }));
    } catch {
      // The unavailable state stays on screen with its retry.
    } finally {
      setRetrying(null);
    }
  };

  const olderSelected = standings.standings_version < standings.latest_standings_version;
  const options = [...items.map((item) => item.standings_version)];
  if (!options.includes(standings.standings_version)) options.push(standings.standings_version);

  return (
    <section aria-labelledby="league-history-heading" {...stylex.props(leagueStyles.content)}>
      <h2
        id="league-history-heading"
        ref={historyHeading}
        tabIndex={-1}
        {...stylex.props(leagueStyles.sectionTitle)}
      >
        {t('leagues.history.title')}
      </h2>
      {versions === null && (
        <>
          <p role="alert" {...stylex.props(leagueStyles.errorText)}>
            {t('leagues.history.unavailable')}
          </p>
          <Button
            variant="secondary"
            busy={retrying === 'versions'}
            onClick={() => void retry('versions')}
          >
            {t('leagues.history.retry')}
          </Button>
        </>
      )}
      <div {...stylex.props(styles.field)}>
        <label htmlFor="league-version-select" {...stylex.props(styles.fieldLabel)}>
          {t('leagues.history.selectVersion')}
        </label>
        <select
          id="league-version-select"
          ref={versionSelect}
          value={standings.standings_version}
          onChange={(event) => {
            const version = Number(event.target.value);
            onSelect(version === standings.latest_standings_version ? null : version);
          }}
          {...stylex.props(styles.select)}
        >
          {options.map((version) => {
            const item = items.find((entry) => entry.standings_version === version);
            return (
              <option key={version} value={version}>
                {label(version)}
                {item ? ` · ${when(item.generated_at)}` : ''}
              </option>
            );
          })}
        </select>
      </div>
      {next !== null && (
        <Button variant="secondary" busy={loading} onClick={() => void loadMore()}>
          {t('leagues.history.loadMore')}
        </Button>
      )}
      {loadedAll && next === null && (
        <output ref={completion} tabIndex={-1} {...stylex.props(leagueStyles.muted)}>
          {t('leagues.history.allLoaded')}
        </output>
      )}
      {failed && (
        <p role="alert" {...stylex.props(leagueStyles.errorText)}>
          {t('leagues.history.unavailable')}
        </p>
      )}

      <SurfaceCard xstyle={leagueStyles.card}>
        <p {...stylex.props(leagueStyles.strongText)}>{label(standings.standings_version)}</p>
        <p {...stylex.props(leagueStyles.muted)}>
          {t('leagues.history.generatedAt', { date: when(standings.generated_at) })}
        </p>
        {selected && (
          <p {...stylex.props(leagueStyles.muted)}>
            {t('leagues.history.periodCutoff', { date: when(selected.effective_end_at) })}
          </p>
        )}
        {selected?.cause === 'late_first_confirmation' && selected.confirmation ? (
          <>
            <p {...stylex.props(leagueStyles.strongText)}>
              {t('leagues.history.lateFirstConfirmation')}
            </p>
            <p {...stylex.props(leagueStyles.text)}>
              {t('leagues.history.lateConfirmationDetail', {
                played: when(selected.confirmation.played_at),
                confirmed: when(selected.confirmation.confirmed_at)
              })}
            </p>
          </>
        ) : (
          <p {...stylex.props(leagueStyles.text)}>
            {t(`leagues.history.cause.${selected?.cause ?? standings.cause}`)}
          </p>
        )}
        {(selected?.basis ?? 'published') === 'reconstructed' && (
          <p {...stylex.props(leagueStyles.muted)}>{t('leagues.history.backfilled')}</p>
        )}
        {olderSelected && (
          <>
            <p {...stylex.props(leagueStyles.blocked)}>
              {t('leagues.history.olderVersion')} {t('leagues.history.revisionAvailable')}
            </p>
            <div {...stylex.props(styles.linkRow)}>
              <Button variant="secondary" onClick={() => onSelect(null)}>
                {t('leagues.history.viewLatest')}
              </Button>
            </div>
          </>
        )}
      </SurfaceCard>

      {auditFailed && !audit && (
        <section aria-labelledby="league-audit-heading" {...stylex.props(leagueStyles.content)}>
          <h3 id="league-audit-heading" {...stylex.props(leagueStyles.sectionTitle)}>
            {t('leagues.history.auditTitle')}
          </h3>
          <p role="alert" {...stylex.props(leagueStyles.errorText)}>
            {t('leagues.history.auditUnavailable')}
          </p>
          <Button
            variant="secondary"
            busy={retrying === 'audit'}
            onClick={() => void retry('audit')}
          >
            {t('leagues.history.retry')}
          </Button>
        </section>
      )}
      {audit && audit.events.length > 0 && (
        <section aria-labelledby="league-audit-heading" {...stylex.props(leagueStyles.content)}>
          <h3
            id="league-audit-heading"
            ref={auditHeading}
            tabIndex={-1}
            {...stylex.props(leagueStyles.sectionTitle)}
          >
            {t('leagues.history.auditTitle')}
          </h3>
          <ul {...stylex.props(styles.auditList)}>
            {audit.events.map((event, index) => {
              const version = event.details.standings_version;
              // Only owner/Admin can close; a human-caused revision is a member's confirmation.
              const reason = event.system_reason
                ? t(`leagues.history.audit.reason.${event.system_reason}`, { defaultValue: '' })
                : t(
                    event.action === 'closed'
                      ? 'leagues.history.audit.byManager'
                      : 'leagues.history.audit.byMember'
                  );
              return (
                <li key={`${event.occurred_at}-${index}`}>
                  {[
                    t(`leagues.history.audit.${event.action}`),
                    when(event.occurred_at),
                    reason,
                    typeof version === 'number'
                      ? t('leagues.history.audit.version', { version })
                      : ''
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </section>
  );
}
