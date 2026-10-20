import type {
  MatchCreationOptions,
  MatchDraft,
  MatchEventCard,
  MatchEventDetail,
  MatchEventListItem,
  MatchEventListResult,
  MatchEventRpcDetail,
  MatchEventRpcListRow,
  MatchInvitee,
  MatchPublishInput
} from '../../src/features/matches/match-contracts';
import { StatusBadge } from '../../src/components/ui/StatusBadge';
import type { ComponentProps } from 'react';
import {
  makeMatchCard,
  makeMatchCreationOptions,
  makeMatchDetail,
  makeMatchDraft,
  makeMatchInvitee,
  makeMatchPublishInput,
  makeMatchRpcDetail,
  makeMatchRpcListRow
} from '../helpers/match-fixtures';

export const card: MatchEventCard = makeMatchCard();
export const item: MatchEventListItem = makeMatchCard();
export const detail: MatchEventDetail = makeMatchDetail();
export const rawDetail: MatchEventRpcDetail = makeMatchRpcDetail();
export const rawList: MatchEventRpcListRow = makeMatchRpcListRow();
export const creation: MatchCreationOptions = makeMatchCreationOptions();
export const draft: MatchDraft = makeMatchDraft();
export const invitee: MatchInvitee = makeMatchInvitee();
export const publish: MatchPublishInput = makeMatchPublishInput();
export const envelope: MatchEventListResult = { items: [item], next_cursor: null, as_of: null };

// @ts-expect-error required projection field
export const missingCardField: MatchEventCard = (({ venue_name: _venue, ...rest }) => rest)(card);
// @ts-expect-error nullable keys are required, even when value may be null
export const missingNullableKey: MatchEventCard = (({ currency: _currency, ...rest }) => rest)(
  card
);
// @ts-expect-error badge must come from SQL badge enum
export const badBadge: MatchEventCard = { ...card, caller_badge: 'member' };
// @ts-expect-error event type must be generated enum
export const badEventType: MatchEventCard = { ...card, event_type: 'social' };
// @ts-expect-error visibility must be generated enum
export const badVisibility: MatchEventCard = { ...card, visibility: 'public' };
// @ts-expect-error team mode must be generated enum
export const badTeamMode: MatchEventCard = { ...card, team_assignment_mode: 'random' };
// @ts-expect-error count fields are numeric
export const badCount: MatchEventCard = { ...card, accepted_count: '5' };
// @ts-expect-error invitees use canonical RPC keys
export const badInvitee: MatchInvitee = { id: invitee.user_id, name: invitee.display_name };
// @ts-expect-error draft has no arbitrary keys
export const badDraft: MatchDraft = { ...draft, surprise: true };
// @ts-expect-error publish JSON has exact known keys
export const badPublish: MatchPublishInput = { ...publish, surprise: true };
// @ts-expect-error options require all three actual RPC payload keys
export const badOptions: MatchCreationOptions = { communities: [] };
// @ts-expect-error raw detail requires as_of
export const missingDetailSnapshot: MatchEventRpcDetail = (({ as_of: _asOf, ...rest }) => rest)(
  rawDetail
);
// @ts-expect-error raw list requires cursor
export const missingListCursor: MatchEventRpcListRow = (({ cursor: _cursor, ...rest }) => rest)(
  rawList
);
// @ts-expect-error shared badge accepts presentation tones, not match-domain state names
export const oldPlayingTone: ComponentProps<typeof StatusBadge>['tone'] = 'playing';
