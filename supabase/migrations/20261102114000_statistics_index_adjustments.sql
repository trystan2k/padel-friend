begin;

-- The community matchup lookup has the same Limit -> Seq Scan plan at the
-- measured 150-group workload with and without the U5-only index.
drop index public.statistics_group_facts_matchup_id;

commit;
