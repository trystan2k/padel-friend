import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { Section } from './PlayerMetric';
import { LeaderStat, RelationshipTable } from './RelationshipList';
import { useRelationshipFormat } from './RelationshipRecordView';
import type { StatisticsResponse } from './statistics-history-contracts';
import { playerStyles as s } from './statistics-player.styles';
import type { PartnerRecords as Records } from './statistics-relationship-contracts';

/**
 * All partners of a player. The best-partner claim needs the configured number of decided matches
 * together; below it the partnership is still listed, just never called best.
 */
export function PartnerRecords({ response }: { response: StatisticsResponse<Records> }) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  if (response.status === 'error') {
    return (
      <Section id="player-partners" title={t('statistics.relationships.records.partners.title')}>
        <p role="alert" {...stylex.props(s.error)}>
          {t(`statistics.errors.${response.code}`)}
        </p>
      </Section>
    );
  }
  const records = response.value;
  const required = records.config.thresholds.best_partnership_min_matches;
  return (
    <Section id="player-partners" title={t('statistics.relationships.records.partners.title')}>
      <dl {...stylex.props(s.stats)}>
        <LeaderStat
          label={t('statistics.player.records.topPartner')}
          metric={records.mostFrequent}
          detail={(value) =>
            t('statistics.player.records.leaderMatches', { matches: f.count(value.groups) })
          }
        />
        <LeaderStat
          label={t('statistics.relationships.records.partners.best')}
          metric={records.best}
          help={t('statistics.relationships.records.partners.bestHelp', {
            required: f.count(required)
          })}
          detail={(value) =>
            value.winRate === null
              ? ''
              : t('statistics.relationships.records.rateIn', {
                  rate: f.ratio(value.winRate),
                  matches: f.count(value.resolved)
                })
          }
        />
      </dl>
      <RelationshipTable
        kind="partners"
        playerId={records.playerId}
        filters={records.filters}
        items={records.items}
        total={records.total}
      />
    </Section>
  );
}
