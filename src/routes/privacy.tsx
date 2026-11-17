import { createFileRoute } from '@tanstack/react-router';
import { PrivacyPolicy } from '../features/privacy/PrivacyPolicy';

// Public on purpose: no auth guard, so the policy stays reachable signed out (Google OAuth
// consent screen, sign-in pages) and signed in.
export const Route = createFileRoute('/privacy')({
  component: PrivacyPolicy
});
