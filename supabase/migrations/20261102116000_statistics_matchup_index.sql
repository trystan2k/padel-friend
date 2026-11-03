begin;

-- The community reader resolves the most-common matchup id to its pairs with
-- `group_facts where matchup_id = $1 limit 1`. The existing matchup index leads with the pair columns,
-- so it cannot serve that predicate. The U5 index (same shape) was dropped by a 150-group
-- measurement that planned a Seq Scan for both variants; that shape of evidence cannot show
-- scale behaviour. The index is restored and justified by a plan-node assertion
-- (test/statistics.performance.integration.test.ts), not by a small-table timing comparison.
create index statistics_group_facts_matchup_id on public.statistics_group_facts (matchup_id);

commit;
