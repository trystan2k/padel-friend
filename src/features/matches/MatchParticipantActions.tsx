import { Menu } from '@base-ui/react/menu';
import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MatchRemovalDialog } from './MatchRemovalDialog';
import { useMatchManagement } from './use-match-management';
import { matchManagementStyles as s } from './match-management.styles';
import { MatchManagementUnavailable } from './MatchManagementUnavailable';
import { matchRegistrationStyles as registrationStyles } from './match-registration.styles';

export function MatchParticipantActions({
  eventId,
  attemptId,
  targetUserId,
  name,
  disabled = false
}: {
  eventId: string;
  attemptId: string;
  targetUserId?: string;
  name?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const controller = useMatchManagement(eventId);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (controller.unavailable)
    return <MatchManagementUnavailable reason={controller.unavailable} focus />;
  if (!targetUserId)
    return (
      <div>
        <Dialog.Root
          open={open}
          onOpenChange={(value) => {
            if (!controller.pending) setOpen(value);
          }}
          disablePointerDismissal={controller.pending}
        >
          <Dialog.Trigger
            ref={trigger}
            disabled={disabled || open || controller.pending}
            {...stylex.props(s.button, registrationStyles.leaveButton)}
          >
            {t('matches.management.leave')}
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop {...stylex.props(s.backdrop)} />
            <Dialog.Popup
              finalFocus={() =>
                trigger.current ?? document.getElementById('match-registration-heading')
              }
              {...stylex.props(s.popup)}
            >
              <Dialog.Title>{t('matches.management.leaveTitle')}</Dialog.Title>
              <Dialog.Description>{t('matches.management.leaveDescription')}</Dialog.Description>
              <output aria-live="polite">
                {controller.feedback ? t(controller.feedback) : null}
              </output>
              <div {...stylex.props(s.row)}>
                <Dialog.Close disabled={controller.pending} {...stylex.props(s.button)}>
                  {t('matches.management.cancel')}
                </Dialog.Close>
                <button
                  type="button"
                  disabled={controller.pending}
                  aria-busy={controller.pending}
                  {...stylex.props(s.button)}
                  onClick={async () => {
                    if (await controller.depart(attemptId)) setOpen(false);
                  }}
                >
                  {t('matches.management.confirm')}
                </button>
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
        {!open && (
          <output aria-live="polite">{controller.feedback ? t(controller.feedback) : null}</output>
        )}
      </div>
    );
  const displayName = name ?? t('matchRegistration.roster.playerFallback');
  return (
    <div>
      <Menu.Root>
        <Menu.Trigger
          ref={trigger}
          disabled={disabled || controller.pending}
          {...stylex.props(s.button, registrationStyles.overflowButton)}
          aria-label={t('matches.management.participantActions', { name: displayName })}
        >
          <span aria-hidden="true">⋯</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup {...stylex.props(s.menu)}>
              <Menu.Item onClick={() => setOpen(true)} {...stylex.props(s.button)}>
                {t('matches.management.remove')}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <MatchRemovalDialog
        open={open}
        onOpenChange={setOpen}
        pending={controller.pending}
        feedback={controller.feedback}
        name={displayName}
        returnFocus={trigger}
        onConfirm={(reason) => controller.depart(attemptId, { userId: targetUserId, reason })}
      />
      {!open && (
        <output aria-live="polite">{controller.feedback ? t(controller.feedback) : null}</output>
      )}
    </div>
  );
}
