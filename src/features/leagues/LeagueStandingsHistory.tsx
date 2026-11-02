import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
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
import { listLeagueStandingsVersions } from './league.functions';
import { styles as leagueStyles } from './league.styles';
import { styles } from './league-standings.styles';

/**
 * Inspect every published final of a closed League: pick a version, see why it exists (including
 * a first result confirmed after the close) and, for owner/Admin, the lifecycle audit trail.
 */
export function LeagueStandingsHistory({
  league,
  standings,
  versions,
  audit,
  onSelect
}: {
  league: LeagueDto;
  standings: LeagueFinalStandings;
  /** Null when the history reader was unavailable; the shown version stays usable. */
  versions: LeagueStandingsVersionsResult | null;
  audit: LeagueStandingsAuditResult | null;
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
  const continued = versions && more?.base === versions ? more : null;
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

  const olderSelected = standings.standings_version < standings.latest_standings_version;
  const options = [...items.map((item) => item.standings_version)];
  if (!options.includes(standings.standings_version)) options.push(standings.standings_version);

  return (
    <section aria-labelledby="league-history-heading" {...stylex.props(leagueStyles.content)}>
      <h2 id="league-history-heading" {...stylex.props(leagueStyles.sectionTitle)}>
        {t('leagues.history.title')}
      </h2>
      {versions === null && (
        <p role="alert" {...stylex.props(leagueStyles.errorText)}>
          {t('leagues.history.unavailable')}
        </p>
      )}
      <div {...stylex.props(styles.field)}>
        <label htmlFor="league-version-select" {...stylex.props(styles.fieldLabel)}>
          {t('leagues.history.selectVersion')}
        </label>
        <select
          id="league-version-select"
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

      {audit && audit.events.length > 0 && (
        <section aria-labelledby="league-audit-heading" {...stylex.props(leagueStyles.content)}>
          <h3 id="league-audit-heading" {...stylex.props(leagueStyles.sectionTitle)}>
            {t('leagues.history.auditTitle')}
          </h3>
          <ul {...stylex.props(styles.auditList)}>
            {audit.events.map((event, index) => {
              const version = event.details.standings_version;
              const reason = event.system_reason
                ? t(`leagues.history.audit.reason.${event.system_reason}`, { defaultValue: '' })
                : t('leagues.history.audit.byManager');
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
