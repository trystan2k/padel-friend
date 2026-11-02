import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { Section } from './PlayerMetric';
import { LeaderStat, RelationshipTable } from './RelationshipList';
import { useRelationshipFormat } from './RelationshipRecordView';
import type { StatisticsResponse } from './statistics-history-contracts';
import { playerStyles as s } from './statistics-player.styles';
import type {
  OpponentRecords as Records,
  RelationshipLeader
} from './statistics-relationship-contracts';

/**
 * All opponents of a player. Best, toughest and closest-rivalry claims need the configured number
 * of decided meetings; below it the head-to-head is still listed without a leader claim.
 */
export function OpponentRecords({ response }: { response: StatisticsResponse<Records> }) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  if (response.status === 'error') {
    return (
      <Section id="player-opponents" title={t('statistics.relationships.records.opponents.title')}>
        <p role="alert" {...stylex.props(s.error)}>
          {t(`statistics.errors.${response.code}`)}
        </p>
      </Section>
    );
  }
  const records = response.value;
  const required = f.count(records.config.thresholds.best_opponent_min_meetings);
  const rivalryRequired = f.count(records.config.thresholds.closest_rivalry_min_meetings);
  const rate = (value: RelationshipLeader) =>
    value.winRate === null
      ? ''
      : t('statistics.relationships.records.rateIn', {
          rate: f.ratio(value.winRate),
          matches: f.count(value.resolved)
        });
  return (
    <Section id="player-opponents" title={t('statistics.relationships.records.opponents.title')}>
      <dl {...stylex.props(s.stats)}>
        <LeaderStat
          label={t('statistics.player.records.topOpponent')}
          metric={records.mostFrequent}
          detail={(value) =>
            t('statistics.player.records.leaderMatches', { matches: f.count(value.groups) })
          }
        />
        <LeaderStat
          label={t('statistics.relationships.records.opponents.best')}
          metric={records.best}
          help={t('statistics.relationships.records.opponents.bestHelp', { required })}
          detail={rate}
        />
        <LeaderStat
          label={t('statistics.relationships.records.opponents.toughest')}
          metric={records.toughest}
          help={t('statistics.relationships.records.opponents.toughestHelp', { required })}
          detail={rate}
        />
        <LeaderStat
          label={t('statistics.relationships.records.opponents.closestRivalry')}
          metric={records.closestRivalry}
          help={t('statistics.relationships.records.opponents.closestRivalryHelp', {
            required: rivalryRequired
          })}
          detail={(value) =>
            value.imbalance === null
              ? ''
              : t('statistics.relationships.records.gapIn', {
                  gap: f.count(value.imbalance),
                  matches: f.count(value.resolved)
                })
          }
        />
      </dl>
      <RelationshipTable
        kind="opponents"
        playerId={records.playerId}
        filters={records.filters}
        items={records.items}
        total={records.total}
      />
    </Section>
  );
}
