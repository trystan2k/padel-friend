import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import type { ManagementParticipant } from './match-management-model';
import type { MatchRosterEntry } from './match-registration-model';
import { requiresMatchReconfirmation } from './match-reconfirmation-model';
import { MatchParticipantActions } from './MatchParticipantActions';
import { matchRegistrationStyles as s } from './match-registration.styles';

export function MatchRosterCard({
  eventId,
  roster,
  participants,
  callerOrder,
  disabled = false
}: {
  eventId: string;
  roster: MatchRosterEntry[];
  participants?: ManagementParticipant[];
  callerOrder: number | null;
  disabled?: boolean;
  started?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const graphemes = new Intl.Segmenter(i18n.language, { granularity: 'grapheme' });
  // Safe roster owns published positions; management supplies only missing
  // accepted rows and action targets, never changes public read permissions.
  const entries = [...roster];
  let playingIndex = 0;
  let reserveIndex = 0;
  for (const player of [...(participants ?? [])].sort(
    (a, b) => a.accepted_order - b.accepted_order
  )) {
    if (requiresMatchReconfirmation(player) || player.participation === null) continue;
    if (player.participation === 'playing') playingIndex += 1;
    else reserveIndex += 1;
    if (entries.some((entry) => entry.accepted_order === player.accepted_order)) continue;
    entries.push({
      accepted_order: player.accepted_order,
      display_name: player.display_name,
      display_level: player.display_level,
      participation: player.participation,
      registration_source: 'member',
      group_number: player.participation === 'playing' ? Math.ceil(playingIndex / 4) : null,
      reserve_position: player.participation === 'playing' ? null : reserveIndex
    });
  }
  entries.sort((a, b) => a.accepted_order - b.accepted_order);
  const sections = new Map<string, MatchRosterEntry[]>();
  for (const entry of entries) {
    const key =
      entry.participation === 'playing'
        ? `group-${entry.group_number ?? 1}`
        : entry.participation === 'reserve_not_playing'
          ? 'notPlaying'
          : 'reserve';
    sections.set(key, [...(sections.get(key) ?? []), entry]);
  }
  const awaiting = participants?.filter(requiresMatchReconfirmation) ?? [];
  const renderRow = (entry: MatchRosterEntry, awaitingConsent = false) => {
    const own = entry.accepted_order === callerOrder;
    const name = own
      ? t('matchRegistration.roster.you')
      : (entry.display_name ?? t('matchRegistration.roster.playerFallback'));
    const words = name.trim().split(/\s+/u);
    const initialsWords =
      words.length > 1 && /^\d+$/u.test(words.at(-1) ?? '') ? words.slice(-2) : words.slice(0, 2);
    const initials = initialsWords
      .map((word) => graphemes.segment(word)[Symbol.iterator]().next().value?.segment ?? '')
      .join('');
    const participant = participants?.find(
      (player) => player.accepted_order === entry.accepted_order
    );
    const placement = awaitingConsent
      ? t('matchRegistration.roster.awaitingTitle')
      : entry.participation === 'playing'
        ? t('matchRegistration.roster.playingLabel')
        : entry.reserve_position === null
          ? t('matchRegistration.badges.reserve')
          : t('matchRegistration.place.reservePosition', { position: entry.reserve_position });
    return (
      <div
        key={entry.accepted_order}
        {...stylex.props(
          s.playerRow,
          !participants && s.passivePlayerRow,
          own && s.playerHighlight
        )}
      >
        <span aria-hidden="true" {...stylex.props(s.initials, own && s.ownInitials)}>
          {initials}
        </span>
        <div {...stylex.props(s.playerIdentity)}>
          <span {...stylex.props(s.playerName)}>{name}</span>
          {!participants && (
            <span {...stylex.props(s.visuallyHidden)}>
              {t(
                entry.participation === 'playing'
                  ? 'matchRegistration.badges.playing'
                  : entry.participation === 'reserve'
                    ? 'matchRegistration.badges.reserve'
                    : 'matchRegistration.badges.reserveNotPlaying'
              )}
            </span>
          )}
          {(own || entry.registration_source === 'guest') && (
            <span {...stylex.props(s.visuallyHidden)}>
              {t(
                `matchRegistration.badges.${entry.registration_source === 'guest' ? 'guest' : entry.registration_source === 'creator' ? 'creator' : 'member'}`
              )}
            </span>
          )}
          {participants && (
            <span {...stylex.props(s.meta)}>
              {awaitingConsent
                ? t('matchRegistration.roster.awaitingStatus')
                : t(
                    entry.display_level === null
                      ? 'matchRegistration.roster.playerDetailUnrated'
                      : 'matchRegistration.roster.playerDetail',
                    {
                      level: entry.display_level,
                      placement
                    }
                  )}
            </span>
          )}
        </div>
        {participant && !own ? (
          <MatchParticipantActions
            eventId={eventId}
            attemptId={participant.attempt_id}
            targetUserId={participant.user_id}
            name={name}
            disabled={disabled}
          />
        ) : !participants ? (
          <span
            aria-label={
              entry.participation === 'playing' && entry.display_level !== null
                ? t('matchRegistration.roster.level', { level: entry.display_level })
                : undefined
            }
            {...stylex.props(s.meta)}
          >
            {entry.participation === 'playing'
              ? entry.display_level
              : entry.reserve_position === null
                ? t('matchRegistration.badges.reserve')
                : t('matchRegistration.roster.position', { position: entry.reserve_position })}
          </span>
        ) : null}
      </div>
    );
  };
  return (
    <section aria-label={t('matchRegistration.aria.roster')} {...stylex.props(s.panel)}>
      <h2
        id={participants ? 'match-participants-management-heading' : undefined}
        tabIndex={participants ? -1 : undefined}
        {...stylex.props(s.title)}
      >
        {t(
          participants ? 'matchRegistration.roster.manageTitle' : 'matchRegistration.roster.title'
        )}
      </h2>
      {[...sections.entries()].map(([key, players]) => (
        <div key={key} {...stylex.props(s.rosterSection)}>
          <h3 {...stylex.props(s.rosterTitle)}>
            {key.startsWith('group-')
              ? t('matchRegistration.roster.groupTitle', { group: Number(key.slice(6)) })
              : t(
                  key === 'notPlaying'
                    ? 'matchRegistration.roster.notPlayingTitle'
                    : 'matchRegistration.roster.reserveTitle'
                )}
          </h3>
          {players.map((entry) => renderRow(entry))}
        </div>
      ))}
      {awaiting.length > 0 && (
        <div {...stylex.props(s.rosterSection)}>
          <h3 {...stylex.props(s.rosterTitle)}>{t('matchRegistration.roster.awaitingTitle')}</h3>
          {awaiting.map((player) =>
            renderRow(
              {
                accepted_order: player.accepted_order,
                display_name: player.display_name,
                display_level: player.display_level,
                participation: 'reserve_not_playing',
                registration_source: 'member',
                group_number: null,
                reserve_position: null
              },
              true
            )
          )}
        </div>
      )}
      <p {...stylex.props(s.note)}>{t('matchRegistration.roster.orderNote')}</p>
      {awaiting.length > 0 && (
        <p {...stylex.props(s.note)}>{t('matchRegistration.roster.awaitingNote')}</p>
      )}
    </section>
  );
}
