| id | severity | location | title | status | owner | iteration |
| -- | -------- | -------- | ----- | ------ | ----- | --------- |
| F1 | major | src/features/matches/MatchRegistrationPanel.tsx:193 | Invite-only invited caller requiring approval gets a request CTA that can never submit (submit_match_registration rejects invite-only requests) | fixed | bug-fixer-specialist | 1 |
| F2 | minor | e2e/matches-registration-visual.spec.ts:2585 | Visual-fixture photo removal races event deletion, so attached photos can silently survive teardown | fixed | bug-fixer-specialist | 1 |
| F3 | major | src/features/matches/matches.functions.ts:84 | Snapshot agreement compares timestamp spelling rather than instant, so an equivalent PostgreSQL serialisation (`+00:00` vs `Z`) would reject a valid page-2 request | fixed | bug-fixer-specialist | 1 |
| F4 | minor | src/components/ui/StatusBadge.tsx:5 | Shared visual tones retain match-domain vocabulary (playing/reserve/guest) instead of generic presentation tones | deferred | deferred | 1 |
| F5 | minor | src/features/matches/match-model.ts:10 | Optionalised card fields leave the planned schema-aligned DTO and boundary decoder work incomplete | deferred | deferred | 1 |
| F6 | minor | supabase/migrations/20261016120200_match_event_functions.sql:166 | Already-accepted invitees now also see approval-required wording alongside their playing/reserve state | fixed | bug-fixer-specialist | 1 |

Status values: `open` | `fixed` | `deferred`. `owner` is the fixing agent or `deferred`.
Reviewers: code-review-specialist (always), architecture-review-specialist (feature/lib/migrations/config changed), ux-ui-reviewer-specialist (UI changed).
