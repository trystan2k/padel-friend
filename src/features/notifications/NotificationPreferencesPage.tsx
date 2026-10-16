import * as stylex from '@stylexjs/stylex';
import { Switch } from '@base-ui/react/switch';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Database } from '../../lib/supabase/database.types';
import {
  getMyNotificationPreferences,
  saveMyNotificationPreferences
} from './notifications.functions';
import { preferenceStyles as styles } from './notification-preferences.styles';

type Preferences = Pick<
  Database['public']['Tables']['notification_preferences']['Row'],
  | 'push_enabled'
  | 'push_community'
  | 'push_matches'
  | 'push_results'
  | 'push_rankings'
  | 'push_leagues'
>;
type PreferenceKey = keyof Preferences;
const categoryKeys: PreferenceKey[] = [
  'push_community',
  'push_matches',
  'push_results',
  'push_rankings',
  'push_leagues'
];
const defaults: Preferences = {
  push_enabled: false,
  push_community: true,
  push_matches: true,
  push_results: true,
  push_rankings: true,
  push_leagues: true
};

export function NotificationPreferencesPage({
  initial
}: {
  initial: Awaited<ReturnType<typeof getMyNotificationPreferences>>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Preferences>(() =>
    initial
      ? {
          push_enabled: initial.push_enabled,
          push_community: initial.push_community,
          push_matches: initial.push_matches,
          push_results: initial.push_results,
          push_rankings: initial.push_rankings,
          push_leagues: initial.push_leagues
        }
      : defaults
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);
  const set = (key: PreferenceKey, checked: boolean) =>
    setValues((current) => ({ ...current, [key]: checked }));
  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      await saveMyNotificationPreferences({ data: values });
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }
  return (
    <main {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.panel)}>
        <Link to="/notifications" {...stylex.props(styles.back)}>
          {t('notificationPreferences.back')}
        </Link>
        <h1 {...stylex.props(styles.title)}>{t('notificationPreferences.title')}</h1>
        <p {...stylex.props(styles.context)}>{t('notificationPreferences.context')}</p>
        <p {...stylex.props(styles.helper)}>{t('notificationPreferences.pushUnavailable')}</p>
        <fieldset {...stylex.props(styles.group)}>
          <legend {...stylex.props(styles.legend)}>{t('notificationPreferences.pushTitle')}</legend>
          <Switch.Root
            checked={values.push_enabled}
            onCheckedChange={(checked) => set('push_enabled', checked)}
            aria-label={t('notificationPreferences.pushTitle')}
            {...stylex.props(styles.switch, values.push_enabled && styles.checked)}
          >
            <Switch.Thumb
              {...stylex.props(styles.thumb, values.push_enabled && styles.thumbChecked)}
            />
          </Switch.Root>
          <p {...stylex.props(styles.helper)}>{t('notificationPreferences.pushHelper')}</p>
          {categoryKeys.map((key) => (
            <label key={key} {...stylex.props(styles.row)}>
              <span {...stylex.props(styles.copy)}>
                {t(`notificationPreferences.categories.${key.slice(5)}`)}
              </span>
              <Switch.Root
                checked={values[key]}
                disabled={!values.push_enabled}
                onCheckedChange={(checked) => set(key, checked)}
                aria-label={t(`notificationPreferences.categories.${key.slice(5)}`)}
                {...stylex.props(styles.switch, values[key] && styles.checked)}
              >
                <Switch.Thumb {...stylex.props(styles.thumb, values[key] && styles.thumbChecked)} />
              </Switch.Root>
            </label>
          ))}
        </fieldset>
        <section aria-labelledby="critical-title" {...stylex.props(styles.always)}>
          <h2 id="critical-title" {...stylex.props(styles.alwaysTitle)}>
            {t('notificationPreferences.criticalTitle')}
          </h2>
          <p {...stylex.props(styles.alwaysCopy)}>{t('notificationPreferences.criticalHelper')}</p>
          <strong {...stylex.props(styles.alwaysBadge)}>
            {t('notificationPreferences.alwaysOn')}
          </strong>
        </section>
        {!online && <p>{t('notificationPreferences.offline')}</p>}
        <button
          type="button"
          disabled={!online || saving}
          onClick={() => void save()}
          {...stylex.props(styles.save)}
        >
          {saving ? t('notificationPreferences.saving') : t('notificationPreferences.save')}
        </button>
        <p
          role={status === 'error' ? 'alert' : undefined}
          aria-live={status === 'error' ? 'assertive' : 'polite'}
        >
          {status ? t(`notificationPreferences.${status}`) : ''}
        </p>
      </section>
    </main>
  );
}
