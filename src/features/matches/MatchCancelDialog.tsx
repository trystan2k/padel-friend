import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useId, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { matchManagementStyles as s } from './match-management.styles';

export function MatchCancelDialog({
  open,
  onOpenChange,
  pending,
  feedback,
  returnFocus,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  pending: boolean;
  feedback: string | null;
  returnFocus: RefObject<HTMLButtonElement | null>;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [reason, setReason] = useState('');
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
          <Dialog.Title>{t('matches.management.cancelTitle')}</Dialog.Title>
          <Dialog.Description>{t('matches.management.cancelDescription')}</Dialog.Description>
          <form
            {...stylex.props(s.section)}
            onSubmit={async (event) => {
              event.preventDefault();
              if (await onConfirm(reason)) onOpenChange(false);
            }}
          >
            <label htmlFor={id}>{t('matches.management.cancelReason')}</label>
            <textarea
              id={id}
              required
              maxLength={500}
              disabled={pending}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              {...stylex.props(s.input)}
            />
            <output aria-live="polite">{feedback ? t(feedback) : null}</output>
            <div {...stylex.props(s.row)}>
              <Dialog.Close disabled={pending} {...stylex.props(s.button)}>
                {t('matches.management.cancel')}
              </Dialog.Close>
              <button
                type="submit"
                disabled={pending || !reason.trim()}
                aria-busy={pending}
                {...stylex.props(s.button)}
              >
                {t('matches.management.cancelMatch')}
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
