import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '../../components/ui/Button';
import { issueInvitation } from './community-admin.functions';
import { searchCommunityInvitees } from './community-invitee.functions';
import { styles } from './community-admin.styles';

export function InviteeSearch({ communityId }: { communityId: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<{ user_id: string; display_name: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let stale = false;
    const current = ++generation.current;
    const timer =
      query.trim().length >= 3
        ? setTimeout(() => {
            setLoading(true);
            void searchCommunityInvitees({
              data: { community_id: communityId, query: query.trim() }
            })
              .then((result) => {
                if (!stale && generation.current === current) setRows(result);
              })
              .catch(() => {
                if (!stale && generation.current === current) setError(true);
              })
              .finally(() => {
                if (!stale && generation.current === current) setLoading(false);
              });
          }, 250)
        : undefined;
    return () => {
      stale = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [communityId, query]);
  async function invite() {
    if (!selected) return;
    setError(false);
    try {
      const result = await issueInvitation({
        data: { community_id: communityId, invitee_user_id: selected }
      });
      setToken(result.token);
    } catch {
      setError(true);
    }
  }
  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setError(true);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button aria-label={t('communityAdmin.inviteUnavailable')} />}>
        {t('communityInvites.invite')}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.confirmBackdrop)} />
        <Dialog.Viewport {...stylex.props(styles.confirmViewport)}>
          <Dialog.Popup {...stylex.props(styles.confirmDialog)}>
            <section {...stylex.props(styles.content)}>
              <Dialog.Title {...stylex.props(styles.confirmTitle)}>
                {t('communityInvites.title')}
              </Dialog.Title>
              <label>
                {t('communityInvites.searchLabel')}{' '}
                <input
                  value={query}
                  onChange={(event) => {
                    setSelected(null);
                    setToken('');
                    setRows([]);
                    setQuery(event.target.value);
                  }}
                  aria-describedby="invitee-search-help"
                />
              </label>
              <p id="invitee-search-help">{t('communityInvites.searchHelp')}</p>
              {loading && <p aria-live="polite">{t('communityInvites.searching')}</p>}
              {!loading && query.trim().length >= 3 && rows.length === 0 && (
                <p>{t('communityInvites.noResults')}</p>
              )}
              {rows.map((person) => (
                <label key={person.user_id}>
                  <input
                    type="radio"
                    name="invitee"
                    value={person.user_id}
                    checked={selected === person.user_id}
                    onChange={() => setSelected(person.user_id)}
                  />{' '}
                  {person.display_name} — {t('communityInvites.select')}
                </label>
              ))}
              <button type="button" disabled={!selected} onClick={() => void invite()}>
                {t('communityInvites.invite')}
              </button>
              {token && (
                <div>
                  <output>
                    {t('communityInvites.issued')}: <code>{token}</code>.{' '}
                    {t('communityInvites.shareHelp')}
                  </output>
                  <Button type="button" onClick={() => void copyToken()}>
                    {t('communityInvites.copyLink')}
                  </Button>
                  {copied && <output aria-live="polite">{t('communityInvites.copied')}</output>}
                </div>
              )}
              {error && <p role="alert">{t('communityInvites.error')}</p>}
              <Dialog.Close render={<Button variant="secondary" />}>
                {t('communityAdmin.cancel')}
              </Dialog.Close>
            </section>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
