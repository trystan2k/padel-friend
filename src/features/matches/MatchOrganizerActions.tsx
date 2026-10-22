import { Menu } from '@base-ui/react/menu';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MatchTransferDialog } from './MatchTransferDialog';
import { MatchCancelDialog } from './MatchCancelDialog';
import type { MatchEventManagement, ManagementParticipant } from './match-management-model';
import { useMatchManagement } from './use-match-management';
import { matchManagementStyles as s } from './match-management.styles';

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
  if (management.status === 'cancelled' || (!management.is_organizer && !cancel)) return null;
  return (
    <section {...stylex.props(s.section)}>
      <h2 id="match-management-heading" tabIndex={-1}>
        {t('matches.management.actions')}
      </h2>
      {management.is_organizer && (
        <p>
          {t(
            management.is_participant
              ? 'matches.management.leaveKeepOrganizing'
              : 'matches.management.organizerOnly'
          )}
        </p>
      )}
      {(transfer || cancel) && (
        <Menu.Root>
          <Menu.Trigger ref={trigger} disabled={controller.pending} {...stylex.props(s.button)}>
            {t('matches.management.actions')}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup {...stylex.props(s.menu)}>
                {transfer && (
                  <Menu.Item
                    {...stylex.props(s.button)}
                    onClick={() => {
                      setVersion(management.version);
                      setDialog('transfer');
                    }}
                  >
                    {t('matches.management.transfer')}
                  </Menu.Item>
                )}
                {cancel && (
                  <Menu.Item
                    {...stylex.props(s.button)}
                    onClick={() => {
                      setVersion(management.version);
                      setDialog('cancel');
                    }}
                  >
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
            player.user_id !== management.owner_id && player.participation !== 'reserve_not_playing'
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
      {!dialog && (
        <output aria-live="polite">{controller.feedback ? t(controller.feedback) : null}</output>
      )}
    </section>
  );
}
