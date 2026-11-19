export type ShellDestination = 'home' | 'matches' | 'community' | 'me';

export type ShellState = {
  /** False on wizard, overlay and nested screens: they own their sticky actions and inset. */
  visible: boolean;
  /** The destination the current path belongs to; Create is an action and is never current. */
  active: ShellDestination | null;
};

const detailSections = new Set(['my', 'past']);

function isSuppressed(segments: string[]): boolean {
  const [root, second, third, fourth] = segments;
  switch (root) {
    // Create wizard, match detail, result recording and groups; only the lists keep the bar.
    case 'matches':
      return second !== undefined && !detailSections.has(second);
    // Admin keeps its own section navigation until its redesign takes it over.
    case 'community':
      return third === 'admin' || (third === 'leagues' && fourth !== undefined);
    case 'notifications':
      return second !== undefined && second !== 'preferences';
    case 'level-reviews':
      return second !== undefined;
    case 'platform-admin':
      return third !== undefined;
    case 'players':
      return third !== undefined;
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
