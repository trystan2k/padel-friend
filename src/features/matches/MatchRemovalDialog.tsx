import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useId, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { hasMatchControlCharacters } from './match-management-edit';
import { matchManagementStyles as s } from './match-management.styles';

export function MatchRemovalDialog({
  open,
  onOpenChange,
  pending,
  feedback,
  onConfirm,
  returnFocus,
  name
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  feedback: string | null;
  onConfirm: (reason: string) => Promise<boolean>;
  returnFocus: RefObject<HTMLButtonElement | null>;
  name: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [reason, setReason] = useState('');
  const valid =
    reason.trim().length > 0 && reason.trim().length <= 500 && !hasMatchControlCharacters(reason);
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
            returnFocus.current ?? document.getElementById('match-management-heading')
          }
          {...stylex.props(s.popup)}
        >
          <Dialog.Title>{t('matches.management.removeTitle', { name })}</Dialog.Title>
          <Dialog.Description>{t('matches.management.removeDescription')}</Dialog.Description>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (valid && !pending && (await onConfirm(reason.trim()))) {
                setReason('');
                onOpenChange(false);
              }
            }}
            {...stylex.props(s.section)}
          >
            <label htmlFor={id}>{t('matches.management.reason')}</label>
            <textarea
              id={id}
              required
              maxLength={500}
              value={reason}
              disabled={pending}
              aria-invalid={(reason.length > 0 && !valid) || undefined}
              aria-describedby={reason.length > 0 && !valid ? `${id}-error` : undefined}
              onChange={(event) => setReason(event.target.value)}
              {...stylex.props(s.input)}
            />
            {reason.length > 0 && !valid && (
              <p id={`${id}-error`}>{t('matches.management.reasonInvalid')}</p>
            )}
            <output aria-live="polite">{feedback ? t(feedback) : null}</output>
            <div {...stylex.props(s.row)}>
              <Dialog.Close disabled={pending} {...stylex.props(s.button)}>
                {t('matches.management.cancel')}
              </Dialog.Close>
              <button
                type="submit"
                disabled={pending || !valid}
                aria-busy={pending}
                {...stylex.props(s.button)}
              >
                {t('matches.management.remove')}
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
