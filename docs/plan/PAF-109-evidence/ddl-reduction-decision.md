# PAF-109 cutoff-suite DDL reduction decision

## Measurement

- Prior cutoff-suite baseline: 17 tests passed in 6.94 s.
- Suite-scope prototype: not run; no prototype timing or duration delta exists.
- Baseline is the previously recorded cutoff-suite run, not a new measurement in this leg.

## Decision: Option B — keep per-call trigger DDL

Do not hoist `ALTER TABLE public.match_events DISABLE/ENABLE TRIGGER
match_event_immutable` out of `setCutoff` and across the cutoff suite.

`setCutoff` currently disables the immutable trigger only around its timestamp
update, then re-enables it in the same trusted SQL block. This is needed by the
cutoff-boundary fixture, including the race case where the cutoff is moved while
registration RPCs wait on a retained lock. Suite-scope disabling would expose a
globally disabled trigger to every connection using the shared local database,
including concurrently running integration suites. Those suites could then
mutate otherwise immutable match-event facts without the database guard. That
changes the tested invariant and is not equivalent to the per-update bypass.

No byte-identical assertion comparison or failure-restoration experiment was
run because no suite-scope prototype was made. Existing overlap and
cancellation assertions remain unchanged. No prototype duration delta is
available.

## Evidence caveat

The 8,762 introspection figure is cumulative-local history, not a per-run
attribution. It must not be interpreted as the cost of this suite or of these
DDL statements in any single run.
