import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { searchMatchInvitees } from './matches.functions';
import { playerInitials } from '../player/player-initials';
import { createMatchStyles as s } from './create-match.styles';
import type { MatchInvitee } from './match-contracts';

export function MatchInviteePicker({
  communityId,
  selected,
  onChange
}: {
  communityId: string;
  selected: MatchInvitee[];
  onChange: (value: MatchInvitee[]) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<{ query: string; items: MatchInvitee[] }>({
    query: '',
    items: []
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    if (query.trim().length < 3)
      return () => {
        active = false;
      };
    const timer = window.setTimeout(() => {
      void searchMatchInvitees({ data: { community_id: communityId, query, limit: 20 } })
        .then((value) => {
          if (active) setResponse({ query, items: value });
        })
        .catch(() => {
          if (active) setError(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [communityId, query]);
  const results = response.query === query ? response.items : [];
  return (
    <section {...stylex.props(s.fields)}>
      <label {...stylex.props(s.field)}>
        {t('matchCreate.invitees.search')}
        <input
          {...stylex.props(s.input)}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLoading(e.target.value.trim().length >= 3);
            setError(false);
          }}
        />
      </label>
      {loading && (
        <p aria-live="polite" {...stylex.props(s.muted)}>
          {t('matchCreate.invitees.loading')}
        </p>
      )}
      {error && (
        <p role="alert" {...stylex.props(s.formMessage)}>
          {t('matchCreate.invitees.error')}
        </p>
      )}
      {results.length > 0 && (
        <div {...stylex.props(s.list)}>
          {results.map((person) => (
            <button
              type="button"
              key={person.user_id}
              onClick={() => {
                if (!selected.some((selectedPerson) => selectedPerson.user_id === person.user_id))
                  onChange([...selected, person]);
              }}
              {...stylex.props(s.row, s.rowAction)}
            >
              <span aria-hidden="true" {...stylex.props(s.avatar)}>
                {playerInitials(person.display_name)}
              </span>
              <span {...stylex.props(s.name)}>{person.display_name}</span>
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <ul aria-label={t('matchCreate.invitees.selected')} {...stylex.props(s.list)}>
          {selected.map((person) => (
            <li key={person.user_id} {...stylex.props(s.row)}>
              <span aria-hidden="true" {...stylex.props(s.avatar)}>
                {playerInitials(person.display_name)}
              </span>
              <span {...stylex.props(s.name)}>{person.display_name}</span>
              <button
                type="button"
                {...stylex.props(s.chip)}
                onClick={() =>
                  onChange(
                    selected.filter((selectedPerson) => selectedPerson.user_id !== person.user_id)
                  )
                }
              >
                {t('matchCreate.invitees.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
