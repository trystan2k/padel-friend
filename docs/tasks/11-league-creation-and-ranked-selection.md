# T11 — Create Leagues and select Ranked Match Events

**Type:** AFK  
**User stories:** US-019, US-020  
**PRD:** §§15.9, 28–29, 69; clarified ranked-event decisions

## Overview

### Context

Unlike contradictory automatic-inclusion passages in the original PRD, the approved V1 policy lets a Match Creator choose Ranked/Unranked per event, defaulting Ranked when an eligible existing League is available.

### Task description

**Goal:** Community members create period-based Leagues; creators explicitly bind eligible events to one existing League.

**In scope:** League Fixed End Date or Open-Ended/Manual creation, member-created setting, owner/Admin controls, Upcoming/Active lifecycle, one Active League per community, default minimum matches for final award; Ranked selector and explicit Active/Upcoming League association, eligibility by intended schedule, members-only ranked registrations/invitations, change/reconfirmation and ranked-period warnings. Unranked Competitive results still affect global skill in T10.

## Planning

### Depends on

- PAF-4 — Create and discover matches (T04).
- PAF-6 — Match management and reconfirmation (T06).

### Risk

**Level**: High

**Explanation**: Existing PRD examples contradict this approved per-event rule. Persist explicit League association and reject ranked guest/mismatched period throughout lifecycle.

## Requirements

### Acceptance criteria

- [ ] Member can create Fixed Date (end after start) or Manual End League; at most one is Active per community; owner/Admin permissions and member-creation setting enforced.
- [ ] New eligible Competitive event defaults Ranked with explicit existing Active/Upcoming League; creator can switch to Unranked. No League created later can claim a prior event retroactively.
- [ ] When multiple existing Leagues could cover the event, creator explicitly selects one before publishing; never auto-bind an arbitrary League.
- [ ] Ranked event admits only active community members, never Public-community nonmember guests; unranked Public guest path remains available.
- [ ] An existing event with accepted nonmember guests cannot switch to Ranked without first resolving their participation and collecting required reconfirmations.
- [ ] Revalidate actual group participants' community membership at `played_at` before accepting a Ranked result; if eligibility fails, reject Ranked submission and require an authorized resolution rather than silently counting that group.
- [ ] Ranked status/selected League change after another player accepts triggers participant reconfirmation; no silent conversion.
- [ ] If scheduled ranked event moves outside selected League period, creator must reschedule inside period or switch to Unranked; participants reconfirm and League impact is shown.
- [ ] League choice does not initialize player standings from global skill; Pencil League creation/validation and match selection designs with translated copy are used.

## Quality assurance

### Test plan

**Automated tests**:

- League date/timezone validation, one-Active constraint, owner/Admin rights, ranked default and explicit binding with overlapping Upcoming Leagues, guest and inactive-at-play rejection, edit/reconfirmation and no retroactive association integration.
- E2E create Upcoming League, schedule Ranked event, opt out, change date outside period and reconfirm.

**Manual test**:

1. Create an Upcoming League and two events, one Ranked and one Unranked; verify Public guest can request only the latter.

**Edge cases**:

- No eligible League, multiple Upcoming Leagues, fixed-window boundary, League closed after event creation, membership inactivated before play, manual League without end date.

### Definition of done

- [ ] All subtasks delivered; `pnpm complete-check` passes without lowering coverage thresholds.
- [ ] QA control gate approved.
- [ ] User review approved.
