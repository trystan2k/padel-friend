import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useId, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagementParticipant } from './match-management-model';
import { matchManagementStyles as s } from './match-management.styles';

export function MatchTransferDialog({
  open,
  onOpenChange,
  pending,
  feedback,
  targets,
  returnFocus,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  pending: boolean;
  feedback: string | null;
  targets: ManagementParticipant[];
  returnFocus: RefObject<HTMLButtonElement | null>;
  onConfirm: (userId: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [target, setTarget] = useState('');
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value);
      }}
      disablePointerDismissal={pending}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(s.backdrop)} />
        <Dialog.Popup
          finalFocus={() =>
            returnFocus.current?.isConnected
              ? returnFocus.current
              : document.getElementById('match-detail-heading')
          }
          {...stylex.props(s.popup)}
        >
          <Dialog.Title>{t('matches.management.transferTitle')}</Dialog.Title>
          <Dialog.Description>{t('matches.management.organizerOnly')}</Dialog.Description>
          <form
            {...stylex.props(s.section)}
            onSubmit={async (event) => {
              event.preventDefault();
              if (await onConfirm(target)) onOpenChange(false);
            }}
          >
            <label htmlFor={id}>{t('matches.management.newOrganizer')}</label>
            <select
              id={id}
              required
              disabled={pending}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              {...stylex.props(s.input)}
            >
              <option value="">{t('matches.management.newOrganizer')}</option>
              {targets.map((player) => (
                <option key={player.user_id} value={player.user_id}>
                  {player.display_name ?? t('matchRegistration.roster.playerFallback')}
                </option>
              ))}
            </select>
            <output aria-live="polite">{feedback ? t(feedback) : null}</output>
            <div {...stylex.props(s.row)}>
              <Dialog.Close disabled={pending} {...stylex.props(s.button)}>
                {t('matches.management.cancel')}
              </Dialog.Close>
              <button
                type="submit"
                disabled={pending || !targets.some((player) => player.user_id === target)}
                aria-busy={pending}
                {...stylex.props(s.button)}
              >
                {t('matches.management.transfer')}
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
