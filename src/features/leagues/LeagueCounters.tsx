import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type { LeagueCountersResult } from './league-contracts';
import { styles } from './league.styles';

const STATS = [
  ['matches', 'leagues.counters.matches'],
  ['wins', 'leagues.counters.wins'],
  ['draws', 'leagues.counters.draws'],
  ['losses', 'leagues.counters.losses'],
  ['sets_won', 'leagues.counters.setsWon'],
  ['sets_lost', 'leagues.counters.setsLost'],
  ['set_differential', 'leagues.counters.setDifferential']
] as const;

/**
 * Participants' confirmed Ranked counters. Deliberately unranked: no position, points or skill
 * data, so provisional and claimed players read identically apart from the badge.
 */
export function LeagueCounters({ counters }: { counters: LeagueCountersResult }) {
  const { t, i18n } = useTranslation();
  const format = new Intl.NumberFormat(i18n.language, { signDisplay: 'exceptZero' });
  return (
    <section aria-labelledby="league-counters-heading" {...stylex.props(styles.content)}>
      <h2 id="league-counters-heading" {...stylex.props(styles.sectionTitle)}>
        {t('leagues.counters.title')}
      </h2>
      {counters.excluded_group_count > 0 && (
        <output {...stylex.props(styles.blocked)}>
          {t('leagues.counters.excluded', { count: counters.excluded_group_count })}
        </output>
      )}
      {counters.participants.length === 0 ? (
        <p {...stylex.props(styles.muted)}>{t('leagues.counters.empty')}</p>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {counters.participants.map((entry) => (
            <li key={entry.user_id}>
              <SurfaceCard xstyle={styles.card}>
                <div {...stylex.props(styles.itemHeader)}>
                  <span {...stylex.props(styles.itemName)}>
                    {entry.display_name ?? t('leagues.counters.unknownPlayer')}
                  </span>
                  {entry.is_provisional && (
                    <span {...stylex.props(styles.muted)}>{t('player.provisional.badge')}</span>
                  )}
                </div>
                <dl {...stylex.props(styles.counterStats)}>
                  {STATS.map(([key, label]) => (
                    <div key={key} {...stylex.props(styles.counterStat)}>
                      <dt {...stylex.props(styles.detailLabel)}>{t(label)}</dt>
                      <dd {...stylex.props(styles.detailValue)}>
                        {key === 'set_differential' ? format.format(entry[key]) : entry[key]}
                      </dd>
                    </div>
                  ))}
                </dl>
              </SurfaceCard>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
