import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import type { ExtremumCandidate } from './statistics-contracts';
import type {
  PlayerActivityBucket,
  PlayerRelationshipLeader,
  PlayerStatistics
} from './statistics-player-contracts';
import { CountStat, MetricStat, ReasonText, Section, Stat, usePlayerFormat } from './PlayerMetric';
import { playerStyles as s } from './statistics-player.styles';

function LeaderStat({ label, leaders }: { label: string; leaders: PlayerRelationshipLeader[] }) {
  const { t } = useTranslation();
  const f = usePlayerFormat();
  const leader = leaders[0];
  return (
    <Stat label={label}>
      {leader ? (
        <strong {...stylex.props(s.value)}>
          {t('statistics.player.records.leaderMatches', { matches: f.count(leader.groups) })}
        </strong>
      ) : (
        <>
          <strong {...stylex.props(s.value, s.valueMuted)}>{t('statistics.player.noValue')}</strong>
          <ReasonText
            metric={{ state: 'unavailable', value: null, reason: 'no_applicable_result' }}
          />
        </>
      )}
      {leaders.length > 1 && (
        <span {...stylex.props(s.detail)}>
          {t('statistics.player.records.tied', { leaders: f.count(leaders.length) })}
        </span>
      )}
    </Stat>
  );
}

/**
 * Advanced records: set patterns, extremes, activity peaks and relationship breadth. Each record
 * is a typed evidence state, so a missing record explains why instead of showing an empty value.
 */
export function PlayerStatisticsRecords({ stats }: { stats: PlayerStatistics }) {
  const { t } = useTranslation();
  const f = usePlayerFormat();
  const { advanced, activity, relationships } = stats;
  const when = (candidate: ExtremumCandidate) => f.date(candidate.at);
  const games = (candidate: ExtremumCandidate) =>
    t('statistics.player.records.gamesOn', { games: f.count(candidate.v), date: when(candidate) });
  const delta = (candidate: ExtremumCandidate) =>
    t('statistics.player.records.ratingOn', {
      delta: f.signed(candidate.v),
      date: when(candidate)
    });
  const expected = (candidate: ExtremumCandidate) =>
    t('statistics.player.records.expectedOn', {
      chance: f.ratio(candidate.v),
      date: when(candidate)
    });
  const bucket = (key: 'week' | 'month') => (entry: PlayerActivityBucket) =>
    t(`statistics.player.records.${key}Matches`, {
      matches: f.count(entry.groups),
      period: key === 'week' ? f.date(entry.period) : f.month(entry.period)
    });
  return (
    <>
      <Section id="player-stats-sets" title={t('statistics.player.sections.setPatterns')}>
        <dl {...stylex.props(s.stats)}>
          <CountStat
            label={t('statistics.player.records.straightSetWins')}
            value={advanced.straightSetWins}
          />
          <CountStat
            label={t('statistics.player.records.straightSetLosses')}
            value={advanced.straightSetLosses}
          />
          <CountStat
            label={t('statistics.player.records.threeSetGroups')}
            value={advanced.threeSetGroups}
          />
          <CountStat
            label={t('statistics.player.records.decidingSetWins')}
            value={advanced.decidingSetWins}
          />
          <CountStat
            label={t('statistics.player.records.decidingSetLosses')}
            value={advanced.decidingSetLosses}
          />
          <MetricStat
            label={t('statistics.player.records.decidingSetWinRate')}
            metric={advanced.decidingSetWinRate}
            format={f.ratio}
            unit="opportunities"
          />
          <MetricStat
            label={t('statistics.player.records.firstSetConversion')}
            metric={advanced.firstSetConversionRate}
            format={f.ratio}
            unit="opportunities"
            help={t('statistics.player.records.firstSetConversionHelp')}
          />
          <MetricStat
            label={t('statistics.player.records.comeback')}
            metric={advanced.comebackWinRate}
            format={f.ratio}
            unit="opportunities"
            help={t('statistics.player.records.comebackHelp')}
          />
          <CountStat
            label={t('statistics.player.records.incompleteDeciders')}
            value={advanced.incompleteDeciders}
            help={t('statistics.player.records.incompleteDecidersHelp')}
          />
        </dl>
      </Section>

      <Section id="player-stats-records" title={t('statistics.player.sections.records')}>
        <dl {...stylex.props(s.stats)}>
          <MetricStat
            label={t('statistics.player.records.cleanestWin')}
            metric={advanced.cleanestWin}
            format={games}
            help={t('statistics.player.records.cleanestWinHelp')}
          />
          <MetricStat
            label={t('statistics.player.records.closestWin')}
            metric={advanced.closestWin}
            format={games}
          />
          <MetricStat
            label={t('statistics.player.records.biggestGain')}
            metric={advanced.biggestGain}
            format={delta}
          />
          <MetricStat
            label={t('statistics.player.records.biggestLoss')}
            metric={advanced.biggestLoss}
            format={delta}
          />
          <MetricStat
            label={t('statistics.player.records.strongestUpset')}
            metric={advanced.strongestUpset}
            format={expected}
            help={t('statistics.player.records.upsetHelp')}
          />
          <MetricStat
            label={t('statistics.player.records.toughestLoss')}
            metric={advanced.toughestLoss}
            format={expected}
            help={t('statistics.player.records.toughestLossHelp')}
          />
        </dl>
      </Section>

      <Section id="player-stats-peaks" title={t('statistics.player.sections.peaks')}>
        <dl {...stylex.props(s.stats)}>
          <MetricStat
            label={t('statistics.player.records.weeklyAverage')}
            metric={activity.weeklyAverage}
            format={f.count}
            help={t('statistics.player.records.weeklyAverageHelp')}
          />
          <MetricStat
            label={t('statistics.player.records.mostActiveWeek')}
            metric={activity.mostActiveWeek}
            format={bucket('week')}
          />
          <MetricStat
            label={t('statistics.player.records.mostActiveMonth')}
            metric={activity.mostActiveMonth}
            format={bucket('month')}
          />
        </dl>
      </Section>

      <Section
        id="player-stats-relationships"
        title={t('statistics.player.sections.relationships')}
      >
        <dl {...stylex.props(s.stats)}>
          <CountStat
            label={t('statistics.player.records.uniquePartners')}
            value={relationships.uniquePartners}
          />
          <CountStat
            label={t('statistics.player.records.uniqueOpponents')}
            value={relationships.uniqueOpponents}
          />
          <CountStat
            label={t('statistics.player.records.uniqueQuartets')}
            value={relationships.uniqueQuartets}
            help={t('statistics.player.records.uniqueQuartetsHelp')}
          />
          <LeaderStat
            label={t('statistics.player.records.topPartner')}
            leaders={relationships.mostFrequentPartners}
          />
          <LeaderStat
            label={t('statistics.player.records.topOpponent')}
            leaders={relationships.mostFrequentOpponents}
          />
          <MetricStat
            label={t('statistics.player.records.partnerShare')}
            metric={relationships.mostFrequentPartnerShare}
            format={f.ratio}
            unit="matches"
          />
        </dl>
      </Section>
    </>
  );
}
