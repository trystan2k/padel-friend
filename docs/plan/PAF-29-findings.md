# PAF-29 Findings Ledger

| id  | severity | location                                                                                                               | title                                                                                  | status   | owner                         | iteration |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------- | ----------------------------- | --------- |
| F1  | minor    | test/community.integration.test.ts:1093                                                                                | Redemption assertion accepts undefined lookup result                                   | fixed    | testing-automation-specialist | 1         |
| F2  | minor    | test/community.integration.test.ts:1175                                                                                | 1.2s expiry fixture can be flaky on slow CI                                            | deferred | deferred                      | 1         |
| F3  | minor    | docs/plan/Plan PAF-29 PAF-2.4 — Join flows: public self-join, private invitations, approval handling, edge cases.md:15 | Committed plan still requires invitation issuance despite the approved PAF-31 deferral | deferred | deferred                      | 1         |
| F4  | minor    | test/community.integration.test.ts:960                                                                                 | Join matrix omits closed-history rejoin and visibility-flip rejection                  | deferred | deferred                      | 1         |

## Notes

- No critical or major findings. No blocking fixes.
- F1 is a trivial test-assertion tightening applied in this delivery.
- F2 (flaky expiry fixture), F3 (plan-doc scope drift after the PAF-31 deferral), F4 (missing edge-case tests) deferred; handed off as a follow-up issue.
- The invitation-issuance deferral to PAF-31 is an approved scope decision (not a finding by itself; F3 is only the plan-document drift).
