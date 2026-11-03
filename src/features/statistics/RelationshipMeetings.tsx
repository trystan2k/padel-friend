import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { RecentMatches, useRelationshipFormat } from './RelationshipRecordView';
import { StatisticsError, StatisticsLoading } from './StatisticsStates';
import type { StatisticsErrorCode } from './statistics-history-contracts';
import type { OpponentStatistics, PairStatistics } from './statistics-relationship-contracts';
import { getOpponentStatistics, getPairStatistics } from './statistics-relationships.functions';

type Subject = PairStatistics | OpponentStatistics;

/** The URL selects a prefix of bounded pages; loaded pages remain available for back/forward. */
export function RelationshipMeetings({
  subject,
  kind,
  offset,
  onOffsetChange
}: {
  subject: Subject;
  kind: 'pair' | 'opponent';
  offset: number;
  onOffsetChange?: (offset: number) => void;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  const [matches, setMatches] = useState(subject.recent);
  const [error, setError] = useState<StatisticsErrorCode | null>(null);
  const total = subject.record.matches.played;
  const loading = matches.length <= offset && matches.length < total && !error;
  const visible = matches.slice(0, offset + 20);

  useEffect(() => {
    if (matches.length > offset || matches.length >= total || error) return undefined;
    let cancelled = false;
    const nextOffset = matches.length;
    const read = kind === 'pair' ? getPairStatistics : getOpponentStatistics;
    void read({
      data: {
        playerId: subject.focalId,
        otherId: subject.otherId,
        ...subject.filters,
        recentOffset: nextOffset
      }
    })
      .then((response) => {
        if (cancelled) return;
        if (response.status === 'error') {
          setError(response.code);
          return;
        }
        if (response.value.recentOffset !== nextOffset || response.value.recent.length === 0) {
          setError('INVALID_STATISTICS_RESPONSE');
          return;
        }
        setMatches((previous) => [...previous, ...response.value.recent]);
      })
      .catch(() => {
        if (!cancelled) setError('STATISTICS_UNAVAILABLE');
      });
    return () => {
      cancelled = true;
    };
  }, [kind, subject, matches.length, offset, total, error]);

  return (
    <RecentMatches matches={visible} showRating={kind === 'opponent'}>
      <p>
        {t('statistics.relationships.showing', {
          shown: f.count(visible.length),
          total: f.count(total)
        })}
      </p>
      {loading && <StatisticsLoading />}
      {error && (
        <StatisticsError
          code={error}
          onRetry={() => {
            setError(null);
          }}
        />
      )}
      {onOffsetChange &&
        !loading &&
        !error &&
        visible.length < total &&
        visible.length > 0 &&
        visible.length % 20 === 0 && (
          <Button type="button" onClick={() => onOffsetChange(offset + 20)}>
            {t('statistics.relationships.showMore')}
          </Button>
        )}
    </RecentMatches>
  );
}
