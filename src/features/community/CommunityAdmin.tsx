import * as stylex from '@stylexjs/stylex';
import { Link, Outlet, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type { CommunityAdminScreenProps } from './community-admin.types';
import { styles } from './community-admin.styles';
import { CommunityAdminDispatcher } from './CommunityAdminViews';

type Props = CommunityAdminScreenProps;

export function dateLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(value)
  );
}
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join('');
}
export function failed(error: unknown) {
  if (!(error instanceof Error)) return 'generic';
  if (error.message === 'UNAUTHENTICATED') return 'session';
  if (error.message === 'FINAL_COMMUNITY_ADMIN') return 'finalAdmin';
  if (error.message === 'INVALID_MEMBERSHIP_TRANSITION') return 'transition';
  return 'generic';
}

export function CommunityAdminShell() {
  return (
    <main {...stylex.props(styles.page)}>
      <Outlet />
    </main>
  );
}

export function CommunityAdminDenied({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const denied = error instanceof Error && error.message === 'NOT_COMMUNITY_ADMIN';
  const missing = error instanceof Error && error.message === 'COMMUNITY_MEMBER_NOT_FOUND';
  const retry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await router.invalidate();
      reset();
    } catch {
      // Keep the error boundary visible when refresh fails.
    } finally {
      setBusy(false);
    }
  };
  return (
    <section {...stylex.props(styles.page)}>
      <SurfaceCard role="alert" xstyle={styles.card}>
        <h1 {...stylex.props(styles.title)}>
          {t(
            denied
              ? 'communityAdmin.accessDeniedTitle'
              : missing
                ? 'communityAdmin.title.member'
                : 'communityAdmin.errorTitle'
          )}
        </h1>
        <p {...stylex.props(styles.copy)}>
          {t(
            denied
              ? 'communityAdmin.accessDenied'
              : missing
                ? 'communityAdmin.empty.member'
                : 'communityAdmin.error.generic'
          )}
        </p>
        <div {...stylex.props(styles.errorActions)}>
          {!denied && !missing && (
            <button
              type="button"
              disabled={busy}
              onClick={retry}
              {...stylex.props(styles.errorAction)}
            >
              {t('communityAdmin.retry')}
            </button>
          )}
          <Link to="/dashboard" {...stylex.props(styles.errorAction)}>
            {t('communityAdmin.backToDashboard')}
          </Link>
        </div>
      </SurfaceCard>
    </section>
  );
}

export function CommunityAdminLoading() {
  const { t } = useTranslation();
  return (
    <section {...stylex.props(styles.page)}>
      <output {...stylex.props(styles.copy)}>{t('communityAdmin.loading')}</output>
    </section>
  );
}

export function CommunityAdminEntries({
  communities
}: {
  communities: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  if (!communities.length) return null;
  return (
    <section
      aria-label={t('communityAdmin.yourCommunities')}
      {...stylex.props(styles.adminEntries)}
    >
      <h2 {...stylex.props(styles.sectionTitle)}>{t('communityAdmin.yourCommunities')}</h2>
      {communities.map((item) => (
        <Link
          key={item.id}
          to="/community/$communityId/admin/requests"
          params={{ communityId: item.id }}
          {...stylex.props(styles.adminEntryLink)}
        >
          {item.name}
        </Link>
      ))}
    </section>
  );
}

export function CommunityAdminScreen(props: Props) {
  return <CommunityAdminDispatcher key={props.community.id} {...props} />;
}
