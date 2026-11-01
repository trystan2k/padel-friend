import { useEffect, useRef, useState } from 'react';
import type { MatchEventDetail, MatchLeagueOption } from './match-contracts';
import type { MatchLeagueOptionsStatus } from './match-league-selection';
import { getMatchLeagueOptions } from './matches.functions';

type State = { key: string; status: 'ready' | 'error'; leagues: MatchLeagueOption[] };

/**
 * Eligible Leagues for an edited schedule. Every request carries a generation so a slow response
 * for an earlier date can never overwrite the options of the current one.
 */
export function useMatchLeagueOptions(
  event: Pick<MatchEventDetail, 'community_id'>,
  startsAt: string,
  enabled: boolean
) {
  const generation = useRef(0);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<State | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(startsAt);
  const key = enabled && valid ? `${event.community_id}|${startsAt}|${reload}` : '';
  useEffect(() => {
    const current = ++generation.current;
    if (key)
      void getMatchLeagueOptions({
        data: {
          community_id: event.community_id,
          date: startsAt.slice(0, 10),
          start_time: startsAt.slice(11)
        }
      })
        .then((result) => {
          if (current === generation.current)
            setState({ key, status: 'ready', leagues: result.leagues });
        })
        .catch(() => {
          if (current === generation.current) setState({ key, status: 'error', leagues: [] });
        });
    return () => {
      generation.current += 1;
    };
  }, [key, event.community_id, startsAt]);
  const status: MatchLeagueOptionsStatus = !key
    ? 'idle'
    : state?.key === key
      ? state.status
      : 'loading';
  return {
    status,
    leagues: status === 'ready' ? (state?.leagues ?? []) : [],
    retry: () => setReload((current) => current + 1)
  };
}
