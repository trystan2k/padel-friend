import * as stylex from '@stylexjs/stylex';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { rootStyles } from '../../root.styles';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type { LeagueListResult } from './league-contracts';
import { leagueErrorCode } from './league-errors';
import { defaultLeagueFormValues, type LeagueFormInput } from './league-form';
import { createLeague } from './league.functions';
import { LeagueForm } from './LeagueForm';
import { styles } from './league.styles';

export function CreateLeaguePage({ data, today }: { data: LeagueListResult; today: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { community, leagues } = data;
  const active = leagues.find((league) => league.status === 'active');
  // A retry of the same input replays the same request; edited input is a new request.
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const submit = async (input: LeagueFormInput) => {
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      const created = await createLeague({
        data: { request_id: attempt.current.requestId, community_id: community.id, ...input }
      });
      await navigate({
        to: '/community/$communityId/leagues/$leagueId',
        params: { communityId: community.id, leagueId: created.id }
      });
      return null;
    } catch (error) {
      return leagueErrorCode(error);
    }
  };

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header, rootStyles.pageHeader)}>
        <div {...stylex.props(styles.headingRow)}>
          <Link
            to="/community/$communityId/leagues"
            params={{ communityId: community.id }}
            aria-label={t('leagues.back')}
            {...stylex.props(styles.backLink)}
          >
            <span aria-hidden="true">‹</span>
          </Link>
          <h1 {...stylex.props(styles.title)}>{t('leagues.form.title')}</h1>
        </div>
        <p {...stylex.props(styles.context)}>
          {t('leagues.communityContext', { community: community.name })}
        </p>
      </header>
      {community.can_create ? (
        <>
          {active && (
            <SurfaceCard role="note" xstyle={styles.conflict}>
              <p {...stylex.props(styles.strongText)}>
                {t('leagues.form.conflict.title', { name: active.name })}
              </p>
              <p {...stylex.props(styles.errorText)}>{t('leagues.form.conflict.body')}</p>
              <Link
                to="/community/$communityId/leagues/$leagueId"
                params={{ communityId: community.id, leagueId: active.id }}
                {...stylex.props(styles.actionLink)}
              >
                {t('leagues.form.conflict.review')} →
              </Link>
            </SurfaceCard>
          )}
          <LeagueForm
            initialValues={defaultLeagueFormValues(today)}
            today={today}
            submitLabel={t('leagues.form.submit')}
            submittingLabel={t('leagues.form.submitting')}
            onSubmit={submit}
          />
          <p {...stylex.props(styles.guidance)}>{t('leagues.form.guidance')}</p>
        </>
      ) : (
        <p role="alert" {...stylex.props(styles.guidance)}>
          {t('leagues.list.creationDisabled')}
        </p>
      )}
    </main>
  );
}
