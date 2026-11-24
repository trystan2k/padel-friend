import { createFileRoute, useRouter } from '@tanstack/react-router';
import { PlayerProfile } from '../features/player/PlayerProfile';
import { getLevelReviewAccess } from '../features/level-reviews/level-review.functions';
import { loadMeStatistics } from '../features/player/me-statistics';
import { getMyPlayerProfile } from '../features/player/player.functions';
import { loadRatingView } from '../features/player/rating-view';
import { LoadingProfile, ProfileError } from '../features/player/ProfileStates';

/**
 * Platform-admin visibility is the server-reported access context. An unavailable read hides the
 * entry (the guarded destination re-checks access); only a lost session propagates.
 */
async function loadPlatformAdmin(): Promise<boolean> {
  try {
    return (await getLevelReviewAccess()).is_platform_admin;
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') throw error;
    return false;
  }
}

export async function loadMeData() {
  const profileRead = getMyPlayerProfile();
  // One statistics read keyed by the authenticated profile; unavailable never blocks the page.
  const [profile, rating, platformAdmin, statistics] = await Promise.all([
    profileRead,
    loadRatingView(),
    loadPlatformAdmin(),
    profileRead.then(({ user_id: userId }) => loadMeStatistics(userId))
  ]);
  return { profile, rating, platformAdmin, statistics };
}

export const Route = createFileRoute('/_protected/me')({
  loader: loadMeData,
  pendingComponent: LoadingProfile,
  errorComponent: ({ error }) => <ProfileError error={error} next="/me" />,
  component: Me
});

// Me destination (frame vARtQ): self profile, level, destination links, edit/availability/avatar,
// rating journey, platform-admin entry (admin only) and sign-out. /players/$playerId keeps its
// statistics role and is reached through the Statistics row.
function Me() {
  const router = useRouter();
  const { profile, rating, platformAdmin, statistics } = Route.useLoaderData();
  return (
    <PlayerProfile
      initialProfile={profile}
      initialRating={rating}
      onRatingReload={() => void router.invalidate()}
      platformAdmin={platformAdmin}
      statistics={statistics}
    />
  );
}
