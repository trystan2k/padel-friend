export type ShellDestination = 'home' | 'matches' | 'community' | 'me';

export type ShellState = {
  /** False on wizard, overlay and nested screens: they own their sticky actions and inset. */
  visible: boolean;
  /** The destination the current path belongs to; Create is an action and is never current. */
  active: ShellDestination | null;
};

const detailSections = new Set(['my', 'past']);

function isSuppressed(segments: string[]): boolean {
  const [root, second, third] = segments;
  switch (root) {
    // Create wizard, match detail, result recording and groups; only the lists keep the bar.
    case 'matches':
      return second !== undefined && !detailSections.has(second);
    // Admin frames draw no app bar; the admin section navigation is its one bar (never two).
    // Statistics (o9iaC1) and the league index (Fj5bc) draw a top bar and no tab bar.
    case 'community':
      return third === 'admin' || third === 'statistics' || third === 'leagues';
    // Index, preferences (y8ErQ) and detail frames all carry a top bar instead of the tab bar (cAqsQ).
    case 'notifications':
    // Level reviews (A9f626) and the player statistics index (RN0yw) are nested screens too.
    case 'level-reviews':
    case 'players':
      return true;
    // The platform review queue (SCPeI) and its detail hide the bar; repairs keep it.
    case 'platform-admin':
      return second === 'level-reviews' || third !== undefined;
    default:
      return false;
  }
}

function activeDestination(segments: string[]): ShellDestination | null {
  switch (segments[0]) {
    case 'dashboard':
      return 'home';
    case 'notifications':
      return 'home';
    case 'matches':
      return 'matches';
    case 'community':
      return 'community';
    case 'me':
    case 'players':
    case 'level-reviews':
    case 'platform-admin':
      return 'me';
    default:
      return null;
  }
}

/** Single source of truth for where the bottom navigation shows and which tab is current. */
export function resolveAppShell(pathname: string): ShellState {
  const segments = pathname.split('/').filter(Boolean);
  return {
    visible: !isSuppressed(segments),
    active: activeDestination(segments)
  };
}
