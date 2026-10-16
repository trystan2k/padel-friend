import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { searchMatchInvitees } from './matches.functions';
import { createMatchStyles as s } from './create-match.styles';

export function MatchInviteePicker({
  communityId,
  selected,
  onChange
}: {
  communityId: string;
  selected: any[];
  onChange: (value: any[]) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<{ query: string; items: any[] }>({
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
        .then((value: any) => {
          if (active) setResponse({ query, items: value ?? [] });
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
      <label>
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
      {loading && <p aria-live="polite">{t('matchCreate.invitees.loading')}</p>}
      {error && <p role="alert">{t('matchCreate.invitees.error')}</p>}
      {results.map((person) => (
        <button
          type="button"
          key={person.id ?? person.user_id}
          onClick={() => {
            const id = person.id ?? person.user_id;
            if (!selected.some((x) => (x.id ?? x.user_id) === id)) onChange([...selected, person]);
          }}
          {...stylex.props(s.button)}
        >
          {person.name ?? person.display_name}
        </button>
      ))}
      <ul>
        {selected.map((person) => (
          <li key={person.id ?? person.user_id}>
            {person.name ?? person.display_name}
            <button
              type="button"
              onClick={() =>
                onChange(
                  selected.filter((x) => (x.id ?? x.user_id) !== (person.id ?? person.user_id))
                )
              }
            >
              {t('matchCreate.invitees.remove')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
