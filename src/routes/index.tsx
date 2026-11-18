import { createFileRoute } from '@tanstack/react-router';
import { PublicHomepage } from '../features/public-homepage/PublicHomepage';
import { getPublicHomepageAuthenticated } from '../features/public-homepage/public-homepage.functions';

// Public on purpose: Google-facing landing page, never redirects. The loader only reports
// whether a session exists so SSR and hydration agree on the CTA variant.
export const Route = createFileRoute('/')({
  loader: () => getPublicHomepageAuthenticated(),
  component: HomeRoute
});

function HomeRoute() {
  const authenticated = Route.useLoaderData();
  return <PublicHomepage authenticated={authenticated} />;
}
