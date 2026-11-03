import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import * as stylex from '@stylexjs/stylex';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { STATISTICS_MATCH_TYPES, type StatisticsFilters as Filters } from './statistics-contracts';
import type { CommunityLeagueOption } from './statistics-community-contracts';
import { communityStyles as s } from './statistics-community.styles';
import { validateStatisticsFilters } from './statistics.validators';

const ALL = '';

type Props = {
  /** The normalized filters the page currently shows (the draft restarts when they change). */
  filters: Filters;
  /** Leagues of the currently selected community only. */
  leagues: CommunityLeagueOption[];
  activeLeagueId: string | null;
  onApply: (next: Filters) => void;
};

/**
 * Community filter bar: League (Active resolves to its specific id, closed ones
 * stay selectable), match type and whole UTC dates. Applying writes the URL, so the view is
 * deep-linkable and reload/back/forward land on the same filters.
 */
export function StatisticsFilters({ filters, leagues, activeLeagueId, onApply }: Props) {
  const { t } = useTranslation();
  const base = useId();
  const [draft, setDraft] = useState<Filters>(filters);
  const [error, setError] = useState<'range' | null>(null);
  const leagueSelectable = draft.communityId !== null && draft.communityId === filters.communityId;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onApply(validateStatisticsFilters(draft));
      setError(null);
    } catch {
      setError('range');
    }
  };
  const reset = () => {
    const cleared: Filters = {
      communityId: filters.communityId,
      leagueId: null,
      type: 'all',
      from: null,
      through: null
    };
    setDraft(cleared);
    setError(null);
    onApply(cleared);
  };

  return (
    <form
      noValidate
      aria-label={t('statistics.filters.title')}
      onSubmit={submit}
      {...stylex.props(s.form)}
    >
      <div {...stylex.props(s.fields)}>
        {leagueSelectable && (
          <div {...stylex.props(s.field)}>
            <label htmlFor={`${base}-league`} {...stylex.props(s.label)}>
              {t('statistics.filters.league')}
            </label>
            <select
              id={`${base}-league`}
              value={draft.leagueId ?? ALL}
              onChange={(event) => setDraft({ ...draft, leagueId: event.target.value || null })}
              {...stylex.props(s.select)}
            >
              <option value={ALL}>{t('statistics.filters.noLeague')}</option>
              {leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.id === activeLeagueId
                    ? t('statistics.filters.activeLeague', { name: league.name })
                    : t('statistics.filters.historicalLeague', { name: league.name })}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <fieldset {...stylex.props(s.fieldset)}>
        <legend {...stylex.props(s.legend)}>{t('statistics.filters.type')}</legend>
        <RadioGroup
          name="type"
          value={draft.type}
          aria-label={t('statistics.filters.type')}
          onValueChange={(value) =>
            setDraft({
              ...draft,
              type: STATISTICS_MATCH_TYPES.find((type) => type === value) ?? 'all'
            })
          }
          {...stylex.props(s.radios)}
        >
          {STATISTICS_MATCH_TYPES.map((type) => (
            <label
              key={type}
              htmlFor={`${base}-type-${type}`}
              {...stylex.props(s.radioOption, draft.type === type && s.radioSelected)}
            >
              <Radio.Root id={`${base}-type-${type}`} value={type} {...stylex.props(s.radio)} />
              {t(`statistics.filters.types.${type}`)}
            </label>
          ))}
        </RadioGroup>
      </fieldset>

      <div {...stylex.props(s.fields)}>
        <TextField
          type="date"
          label={t('statistics.filters.from')}
          helper={t('statistics.filters.utc')}
          value={draft.from ?? ''}
          max={draft.through ?? undefined}
          onChange={(event) => setDraft({ ...draft, from: event.target.value || null })}
        />
        <TextField
          type="date"
          label={t('statistics.filters.through')}
          helper={t('statistics.filters.utc')}
          value={draft.through ?? ''}
          min={draft.from ?? undefined}
          error={error === 'range' ? t('statistics.filters.rangeError') : undefined}
          onChange={(event) => setDraft({ ...draft, through: event.target.value || null })}
        />
      </div>

      <div {...stylex.props(s.actions)}>
        <Button type="submit">{t('statistics.filters.apply')}</Button>
        <Button type="button" variant="secondary" onClick={reset}>
          {t('statistics.filters.reset')}
        </Button>
      </div>
    </form>
  );
}
