import { createContext, useContext } from 'react';
import type { Locale } from '../../i18n/config';

export type AppTheme = 'light' | 'dark';

/**
 * The persisted language and theme preferences owned by the root layout. The profile edit form
 * reads and applies them with the same handlers as the language and theme chips.
 */
export type AppPreferences = {
  locale: Locale;
  theme: AppTheme;
  changeLocale: (next: string) => Promise<void>;
  changeTheme: (next: AppTheme) => void;
};

export const AppPreferencesContext = createContext<AppPreferences | null>(null);

/** Null outside the root layout (isolated renders), where the preferences section is omitted. */
export function useAppPreferences(): AppPreferences | null {
  return useContext(AppPreferencesContext);
}
