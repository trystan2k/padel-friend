import { createFileRoute, useRouter } from '@tanstack/react-router';
import { PlayerProfile } from '../features/player/PlayerProfile';
import { getMyPlayerProfile } from '../features/player/player.functions';
import { loadRatingView } from '../features/player/rating-view';
import { LoadingProfile, ProfileError } from '../features/player/ProfileStates';

export async function loadMeData() {
  const [profile, rating] = await Promise.all([getMyPlayerProfile(), loadRatingView()]);
  return { profile, rating };
}

export const Route = createFileRoute('/_protected/me')({
  loader: loadMeData,
  pendingComponent: LoadingProfile,
  errorComponent: ({ error }) => <ProfileError error={error} next="/me" />,
  component: Me
});

// Composition point of the Me destination: today it hosts the existing self profile (avatar,
// edit, availability, level journey, level review entry, sign-out). The redesigned Me page
// extends this component instead of adding another destination.
function Me() {
  const router = useRouter();
  const { profile, rating } = Route.useLoaderData();
  return (
    <PlayerProfile
      initialProfile={profile}
      initialRating={rating}
      onRatingReload={() => void router.invalidate()}
    />
  );
}
