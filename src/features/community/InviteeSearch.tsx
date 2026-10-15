import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '../../components/ui/Button';
import { issueInvitation } from './community-admin.functions';
import { searchCommunityInvitees } from './community-invitee.functions';
import { styles } from './community-admin.styles';

const inviteeStyles = stylex.create({
  option: {
    boxSizing: 'border-box',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    display: 'flex',
    alignItems: 'center'
  }
});

type IssuedInvitation = {
  token: string;
  inviteeId: string;
  inviteeName: string;
};

export function InviteeSearch({ communityId }: { communityId: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<{ user_id: string; display_name: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<IssuedInvitation | null>(null);
  const [copiedInvitation, setCopiedInvitation] = useState<IssuedInvitation | null>(null);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const generation = useRef(0);
  const issuanceInFlight = useRef(false);
  const invitationRef = useRef<IssuedInvitation | null>(null);
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
                // Search results are replaceable; stale responses must not replace newer results.
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
    if (!selected || issuanceInFlight.current) return;
    const inviteeId = selected;
    const inviteeName = rows.find((person) => person.user_id === inviteeId)?.display_name;
    if (!inviteeName) return;
    // Issuance responses contain the only plaintext token; never discard a successful response as stale.
    issuanceInFlight.current = true;
    setIssuing(true);
    setError(false);
    setCopiedInvitation(null);
    try {
      const result = await issueInvitation({
        data: { community_id: communityId, invitee_user_id: inviteeId }
      });
      const issuedInvitation = { token: result.token, inviteeId, inviteeName };
      invitationRef.current = issuedInvitation;
      setInvitation(issuedInvitation);
    } catch {
      setError(true);
    } finally {
      issuanceInFlight.current = false;
      setIssuing(false);
    }
  }
  async function copyToken() {
    if (!invitation) return;
    const currentInvitation = invitation;
    try {
      await navigator.clipboard.writeText(currentInvitation.token);
      if (invitationRef.current === currentInvitation) setCopiedInvitation(currentInvitation);
    } catch {
      if (invitationRef.current === currentInvitation) setError(true);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button aria-label={t('communityInvites.invite')} />}>
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
                    generation.current += 1;
                    invitationRef.current = null;
                    setCopiedInvitation(null);
                    setLoading(false);
                    setError(false);
                    setSelected(null);
                    setInvitation(null);
                    setRows([]);
                    setQuery(event.target.value);
                  }}
                  aria-describedby="invitee-search-help"
                />
              </label>
              <p id="invitee-search-help">{t('communityInvites.searchHelp')}</p>
              {loading && <p aria-live="polite">{t('communityInvites.searching')}</p>}
              {!loading && !error && query.trim().length >= 3 && rows.length === 0 && (
                <p>{t('communityInvites.noResults')}</p>
              )}
              {rows.map((person) => (
                <label key={person.user_id} {...stylex.props(inviteeStyles.option)}>
                  <input
                    type="radio"
                    name="invitee"
                    value={person.user_id}
                    checked={selected === person.user_id}
                    onChange={() => {
                      if (selected === person.user_id) return;
                      setCopiedInvitation(null);
                      setError(false);
                      setSelected(person.user_id);
                    }}
                  />{' '}
                  {person.display_name} — {t('communityInvites.select')}
                </label>
              ))}
              <Button
                type="button"
                disabled={!selected || issuing}
                busy={issuing}
                onClick={() => void invite()}
              >
                {t('communityInvites.invite')}
              </Button>
              {invitation && (
                <div>
                  <output>
                    {t('communityInvites.issued')}: {invitation.inviteeName} —{' '}
                    <code>{invitation.token}</code>. {t('communityInvites.shareHelp')}
                  </output>
                  <Button type="button" onClick={() => void copyToken()}>
                    {t('communityInvites.copyLink')}
                  </Button>
                  {copiedInvitation === invitation && (
                    <output aria-live="polite">{t('communityInvites.copied')}</output>
                  )}
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
