import { Menu } from '@base-ui/react/menu';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MatchTransferDialog } from './MatchTransferDialog';
import { MatchCancelDialog } from './MatchCancelDialog';
import type { MatchEventManagement, ManagementParticipant } from './match-management-model';
import { useMatchManagement } from './use-match-management';
import { matchManagementStyles as s } from './match-management.styles';
import {
  MatchManagementUnavailable,
  managementUnavailableReason
} from './MatchManagementUnavailable';

export function MatchOrganizerActions({
  eventId,
  management,
  participants
}: {
  eventId: string;
  management: MatchEventManagement;
  participants: ManagementParticipant[];
}) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<'transfer' | 'cancel' | null>(null);
  const [version, setVersion] = useState(management.version);
  const trigger = useRef<HTMLButtonElement>(null);
  const controller = useMatchManagement(eventId);
  const transfer = management.is_organizer && management.actions.transfer.allowed;
  const cancel = management.actions.cancel.allowed;
  const unavailable = managementUnavailableReason(management, controller.unavailable);
  if (unavailable && unavailable !== 'closed')
    return <MatchManagementUnavailable reason={unavailable} focus={!!controller.unavailable} />;
  if (management.status === 'cancelled' || (!management.is_organizer && !cancel)) return null;
  return (
    <section
      aria-labelledby="match-management-heading"
      {...stylex.props(s.section, s.managementCard)}
    >
      <h2 id="match-management-heading" tabIndex={-1} {...stylex.props(s.cardTitle)}>
        {t('matches.management.title')}
      </h2>
      {management.is_organizer && (
        <p {...stylex.props(s.copy)}>
          {t(
            management.is_participant
              ? 'matches.management.leaveKeepOrganizing'
              : 'matches.management.organizerOnly'
          )}
        </p>
      )}
      {(transfer || cancel) && (
        <Menu.Root>
          <Menu.Trigger
            ref={trigger}
            disabled={controller.pending}
            {...stylex.props(s.button, s.actionsTrigger)}
          >
            <span aria-hidden="true">⋯</span>
            {t('matches.management.actions')}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner
              side="bottom"
              align="end"
              sideOffset={6}
              {...stylex.props(s.menuPositioner)}
            >
              <Menu.Popup {...stylex.props(s.menu)}>
                {transfer && (
                  <Menu.Item
                    {...stylex.props(s.menuItem, s.transferItem)}
                    onClick={() => {
                      setVersion(management.version);
                      setDialog('transfer');
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      {...stylex.props(s.icon)}
                    >
                      <circle cx="10" cy="7" r="4" />
                      <path d="M2 21v-3a8 8 0 0 1 16 0v3M17 3a4 4 0 0 1 0 8M20 14a7 7 0 0 1 2 5v2" />
                    </svg>
                    {t('matches.management.transfer')}
                  </Menu.Item>
                )}
                {cancel && (
                  <Menu.Item
                    {...stylex.props(s.menuItem, s.cancelItem)}
                    onClick={() => {
                      setVersion(management.version);
                      setDialog('cancel');
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      {...stylex.props(s.icon)}
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="m9 9 6 6m0-6-6 6" />
                    </svg>
                    {t('matches.management.cancelMatch')}
                  </Menu.Item>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
      <MatchTransferDialog
        open={dialog === 'transfer'}
        onOpenChange={(value) => {
          if (!value) setDialog(null);
        }}
        pending={controller.pending}
        feedback={controller.feedback}
        returnFocus={trigger}
        targets={participants.filter(
          (player) =>
            player.user_id !== management.owner_id &&
            (player.participation === 'playing' || player.participation === 'reserve')
        )}
        onConfirm={(targetUserId) => controller.manage(version, { targetUserId })}
      />
      <MatchCancelDialog
        open={dialog === 'cancel'}
        onOpenChange={(value) => {
          if (!value) setDialog(null);
        }}
        pending={controller.pending}
        feedback={controller.feedback}
        returnFocus={trigger}
        onConfirm={(reason) => controller.manage(version, { reason })}
      />
      {!dialog && controller.feedback && (
        <output aria-live="polite">{controller.feedback ? t(controller.feedback) : null}</output>
      )}
    </section>
  );
}
