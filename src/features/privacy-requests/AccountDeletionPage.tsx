import { AlertDialog } from '@base-ui/react/alert-dialog';
import * as stylex from '@stylexjs/stylex';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { TopBar } from '../../components/ui/TopBar';
import { PRIVACY_CONTACT_EMAIL } from '../privacy/privacy-content';
import {
  type MyDeletionRequest,
  type PrivacyCaseState,
  type PrivacyReceipt,
  type PrivacyRequestErrorCode,
  type PrivacyRequestResponse
} from './privacy-request-model';
import {
  getMyDeletionRequest,
  requestDeletion,
  withdrawMyDeletionRequest
} from './privacy-request.functions';
import { deletion as s } from './account-deletion.styles';

const TONE = {
  received: s.toneAmber,
  verified: s.toneAmber,
  ready: s.toneAmber,
  executing: s.toneRed,
  app_data_erased: s.toneRed,
  supabase_erased: s.toneRed,
  closed: s.toneGreen,
  withdrawn: s.toneMuted,
  blocked: s.toneRed
} as const satisfies Record<PrivacyCaseState, unknown>;

const DISAPPEARS = ['profile', 'photos', 'preferences', 'participation', 'notifications'] as const;

const toStatus = (receipt: PrivacyReceipt): MyDeletionRequest => ({
  reference: receipt.reference,
  state: receipt.state,
  received_at: receipt.received_at,
  blocked: receipt.state === 'blocked',
  can_withdraw: receipt.can_withdraw
});

const isOpen = (state: PrivacyCaseState) => state !== 'withdrawn' && state !== 'closed';

/**
 * Own-account deletion pane. Sending the request deletes nothing: an operator reviews it and verifies it
 * through the account email before any erasure. The dialog states what disappears, what may remain,
 * the loss of access and the withdrawal cutoff before the only mutation, and it is cancellable at every step.
 */
export function AccountDeletionPage({
  initial
}: {
  initial: PrivacyRequestResponse<MyDeletionRequest | null>;
}) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const [current, setCurrent] = useState<MyDeletionRequest | null>(
    initial.status === 'ok' ? initial.value : null
  );
  const [loadFailure, setLoadFailure] = useState<PrivacyRequestErrorCode | null>(
    initial.status === 'error' ? initial.code : null
  );
  const [requestOpen, setRequestOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<PrivacyRequestErrorCode | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [existing, setExisting] = useState<string | null>(null);
  const inFlight = useRef(false);
  const commandId = useRef<string>('');
  const requestTrigger = useRef<HTMLButtonElement | null>(null);
  const withdrawTrigger = useRef<HTMLButtonElement | null>(null);
  const status = useRef<HTMLHeadingElement | null>(null);

  async function refresh() {
    try {
      const result = await getMyDeletionRequest();
      if (result.status === 'ok') {
        setCurrent(result.value);
        setLoadFailure(null);
      } else setLoadFailure(result.code);
    } catch {
      setLoadFailure('unavailable');
    }
  }

  async function run(
    action: () => Promise<PrivacyRequestResponse<PrivacyReceipt>>,
    onOk: (receipt: PrivacyReceipt) => void
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await action();
      if (result.status === 'ok') onOk(result.value);
      else {
        setFailure(result.code);
        // A refused withdrawal means the state moved on: show the real state.
        if (result.code === 'not_withdrawable' || result.code === 'not_found') {
          setWithdrawOpen(false);
          await refresh();
        }
      }
    } catch {
      setFailure('unavailable');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const send = () =>
    run(
      () => requestDeletion({ data: { command_id: commandId.current } }),
      (receipt) => {
        setCurrent(toStatus(receipt));
        setExisting(receipt.replayed ? receipt.reference : null);
        setAnnouncement(t('accountDeletion.announce.requested', { reference: receipt.reference }));
        setRequestOpen(false);
      }
    );
  const withdraw = () =>
    run(
      () => withdrawMyDeletionRequest({ data: { command_id: commandId.current } }),
      (receipt) => {
        setCurrent(toStatus(receipt));
        setExisting(null);
        setAnnouncement(t('accountDeletion.announce.withdrawn'));
        setWithdrawOpen(false);
      }
    );

  const open = current !== null && isOpen(current.state);
  const received = current
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
        new Date(current.received_at)
      )
    : '';

  return (
    <main data-route-chrome="navigation" {...stylex.props(s.page)}>
      <TopBar
        xstyle={s.barFrame}
        title={t('accountDeletion.title')}
        back={{ to: '/me', label: t('accountDeletion.back') }}
      />
      {loadFailure && (
        <div {...stylex.props(s.card)}>
          <p role="alert" {...stylex.props(s.alertText)}>
            {t('accountDeletion.errors.loadFailed')}
          </p>
          <button type="button" onClick={() => void refresh()} {...stylex.props(s.textButton)}>
            {t('accountDeletion.retry')}
          </button>
        </div>
      )}
      {failure && !requestOpen && !withdrawOpen && (
        <p role="alert" {...stylex.props(s.alertText)}>
          {t(`accountDeletion.errors.${failure}`)}
        </p>
      )}
      <output aria-live="polite" {...stylex.props(announcement ? s.notice : s.srOnly)}>
        {announcement}
      </output>
      {existing && (
        <p {...stylex.props(s.notice)}>
          {t('accountDeletion.notice.existing', { reference: existing })}
        </p>
      )}
      {current && (
        <section aria-labelledby={headingId} {...stylex.props(s.statusNotice, TONE[current.state])}>
          <div {...stylex.props(s.noticeCopy)}>
            <h2 id={headingId} ref={status} tabIndex={-1} {...stylex.props(s.statusLabel)}>
              {t(`accountDeletion.state.${current.state}`)}
            </h2>
            <p {...stylex.props(s.statusText)}>{t(`accountDeletion.detail.${current.state}`)}</p>
          </div>
        </section>
      )}
      {current && (
        <SurfaceCard xstyle={s.card}>
          <h2 {...stylex.props(s.cardTitle)}>{t('accountDeletion.status.heading')}</h2>
          <dl {...stylex.props(s.facts)}>
            <dt {...stylex.props(s.factLabel)}>{t('accountDeletion.status.reference')}</dt>
            <dd {...stylex.props(s.factValue)}>{current.reference}</dd>
            <dt {...stylex.props(s.factLabel)}>{t('accountDeletion.status.received')}</dt>
            <dd {...stylex.props(s.factValue)}>{received}</dd>
          </dl>
          {open && (
            <p {...stylex.props(s.meta)}>
              {t(
                current.can_withdraw
                  ? 'accountDeletion.status.canWithdraw'
                  : 'accountDeletion.status.cannotWithdraw'
              )}
            </p>
          )}
          <div {...stylex.props(s.actions)}>
            {open && current.can_withdraw && (
              <Button
                variant="secondary"
                ref={withdrawTrigger}
                onClick={() => {
                  commandId.current = crypto.randomUUID();
                  setFailure(null);
                  setWithdrawOpen(true);
                }}
              >
                {t('accountDeletion.status.withdraw')}
              </Button>
            )}
            <button type="button" onClick={() => void refresh()} {...stylex.props(s.textButton)}>
              {t('accountDeletion.status.refresh')}
            </button>
          </div>
        </SurfaceCard>
      )}
      {!open && (
        <SurfaceCard xstyle={s.card}>
          <h2 {...stylex.props(s.cardTitle)}>{t('accountDeletion.intro.heading')}</h2>
          <p {...stylex.props(s.body)}>{t('accountDeletion.intro.sends')}</p>
          <p {...stylex.props(s.body)}>{t('accountDeletion.intro.review')}</p>
          <div {...stylex.props(s.actions)}>
            <Button
              variant="destructive"
              ref={requestTrigger}
              onClick={() => {
                commandId.current = crypto.randomUUID();
                setFailure(null);
                setRequestOpen(true);
              }}
            >
              {t('accountDeletion.intro.start')}
            </Button>
          </div>
        </SurfaceCard>
      )}
      <SurfaceCard xstyle={s.card}>
        <h2 {...stylex.props(s.cardTitle)}>{t('accountDeletion.fallback.title')}</h2>
        <p {...stylex.props(s.body)}>{t('accountDeletion.fallback.body')}</p>
        <a
          href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
          aria-label={t('accountDeletion.fallback.mailLabel')}
          {...stylex.props(s.mailLink)}
        >
          {PRIVACY_CONTACT_EMAIL}
        </a>
      </SurfaceCard>

      <AlertDialog.Root
        open={requestOpen}
        onOpenChange={(value) => !pending && setRequestOpen(value)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop {...stylex.props(s.backdrop)} />
          <AlertDialog.Popup
            finalFocus={() =>
              requestTrigger.current?.isConnected ? requestTrigger.current : status.current
            }
            {...stylex.props(s.popup)}
          >
            <AlertDialog.Title {...stylex.props(s.popupTitle)}>
              {t('accountDeletion.dialog.title')}
            </AlertDialog.Title>
            <AlertDialog.Description {...stylex.props(s.popupBody)}>
              {t('accountDeletion.dialog.summary')}
            </AlertDialog.Description>
            <div {...stylex.props(s.disclosure)}>
              <section {...stylex.props(s.disclosureItem)}>
                <h3 {...stylex.props(s.disclosureTitle)}>
                  {t('accountDeletion.dialog.disappears.title')}
                </h3>
                <ul {...stylex.props(s.disclosureList)}>
                  {DISAPPEARS.map((item) => (
                    <li key={item}>{t(`accountDeletion.dialog.disappears.${item}`)}</li>
                  ))}
                </ul>
              </section>
              <section {...stylex.props(s.disclosureItem)}>
                <h3 {...stylex.props(s.disclosureTitle)}>
                  {t('accountDeletion.dialog.remains.title')}
                </h3>
                <p {...stylex.props(s.disclosureBody)}>
                  {t('accountDeletion.dialog.remains.body', {
                    placeholder: t('player.formerPlayer')
                  })}
                </p>
              </section>
              <section {...stylex.props(s.disclosureItem)}>
                <h3 {...stylex.props(s.disclosureTitle)}>
                  {t('accountDeletion.dialog.access.title')}
                </h3>
                <p {...stylex.props(s.disclosureBody)}>{t('accountDeletion.dialog.access.body')}</p>
              </section>
              <section {...stylex.props(s.disclosureItem)}>
                <h3 {...stylex.props(s.disclosureTitle)}>
                  {t('accountDeletion.dialog.cutoff.title')}
                </h3>
                <p {...stylex.props(s.disclosureBody)}>{t('accountDeletion.dialog.cutoff.body')}</p>
              </section>
            </div>
            {failure && (
              <p role="alert" {...stylex.props(s.alertText)}>
                {t(`accountDeletion.errors.${failure}`, { reference: current?.reference ?? '' })}
              </p>
            )}
            <div {...stylex.props(s.actions)}>
              <AlertDialog.Close
                disabled={pending}
                render={<Button variant="secondary">{t('accountDeletion.dialog.cancel')}</Button>}
              />
              <Button variant="destructive" busy={pending} onClick={() => void send()}>
                {t(pending ? 'accountDeletion.dialog.sending' : 'accountDeletion.dialog.confirm')}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={withdrawOpen}
        onOpenChange={(value) => !pending && setWithdrawOpen(value)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop {...stylex.props(s.backdrop)} />
          <AlertDialog.Popup
            finalFocus={() =>
              withdrawTrigger.current?.isConnected ? withdrawTrigger.current : status.current
            }
            {...stylex.props(s.popup)}
          >
            <AlertDialog.Title {...stylex.props(s.popupTitle)}>
              {t('accountDeletion.withdrawDialog.title')}
            </AlertDialog.Title>
            <AlertDialog.Description {...stylex.props(s.popupBody)}>
              {t('accountDeletion.withdrawDialog.body')}
            </AlertDialog.Description>
            {failure && (
              <p role="alert" {...stylex.props(s.alertText)}>
                {t(`accountDeletion.errors.${failure}`, { reference: current?.reference ?? '' })}
              </p>
            )}
            <div {...stylex.props(s.actions)}>
              <AlertDialog.Close
                disabled={pending}
                render={
                  <Button variant="secondary">{t('accountDeletion.withdrawDialog.keep')}</Button>
                }
              />
              <Button busy={pending} onClick={() => void withdraw()}>
                {t(
                  pending
                    ? 'accountDeletion.withdrawDialog.withdrawing'
                    : 'accountDeletion.withdrawDialog.confirm'
                )}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </main>
  );
}
