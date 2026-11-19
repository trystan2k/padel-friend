import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useId, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
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
          {...stylex.props(s.popup, s.sheet)}
        >
          <Dialog.Title {...stylex.props(s.dialogTitle)}>
            {t('matches.management.transferTitle')}
          </Dialog.Title>
          <Dialog.Description {...stylex.props(s.copy)}>
            {t('matches.management.organizerOnly')}
          </Dialog.Description>
          <form
            {...stylex.props(s.dialogForm)}
            onSubmit={async (event) => {
              event.preventDefault();
              if (await onConfirm(target)) onOpenChange(false);
            }}
          >
            <label htmlFor={id} {...stylex.props(s.fieldLabel)}>
              {t('matches.management.newOrganizer')}
            </label>
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
            <div {...stylex.props(s.dialogActions)}>
              <Button
                type="submit"
                disabled={!targets.some((player) => player.user_id === target)}
                busy={pending}
              >
                {t('matches.management.transfer')}
              </Button>
              <Dialog.Close disabled={pending} render={<Button variant="secondary" />}>
                {t('matches.management.cancel')}
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
