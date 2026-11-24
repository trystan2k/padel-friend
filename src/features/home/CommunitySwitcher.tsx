import { Select } from '@base-ui/react/select';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { communityStyles } from '../community/community-surface.styles';
import type { HomeCommunity } from './home-contracts';
import { homeStyles as s } from './home.styles';

/**
 * Selecting only changes which community Home shows; it never grants access to anything. The
 * `home` variant is the Home pill (avatar, name, caret); `community` keeps the heading-style
 * trigger used by the Community surface.
 */
export function CommunitySwitcher({
  communities,
  value,
  onSelect,
  variant = 'home'
}: {
  communities: HomeCommunity[];
  value: string | null;
  onSelect: (communityId: string) => void;
  variant?: 'home' | 'community';
}) {
  const { t } = useTranslation();
  const items = communities.map((community) => ({ value: community.id, label: community.name }));
  const selected = items.find((item) => item.value === value);
  const initial = selected ? (Array.from(selected.label.trim())[0] ?? '').toUpperCase() : '';
  const pill = variant === 'home';
  return (
    <Select.Root
      items={items}
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string' && next !== value) onSelect(next);
      }}
    >
      <div {...stylex.props(s.switcher)}>
        <Select.Label {...stylex.props(s.switcherLabel, communityStyles.srOnly)}>
          {t('home.switcherLabel')}
        </Select.Label>
        <Select.Trigger
          {...stylex.props(
            pill ? s.pill : s.trigger,
            variant === 'community' && communityStyles.switchTrigger
          )}
        >
          {pill && (
            <span aria-hidden="true" {...stylex.props(s.pillAvatar)}>
              {initial}
            </span>
          )}
          <span {...stylex.props(pill && s.pillName)}>
            <Select.Value placeholder={t('home.switcherLabel')} />
          </span>
          <Select.Icon aria-hidden="true" {...stylex.props(pill && s.pillCaret)}>
            ▾
          </Select.Icon>
        </Select.Trigger>
      </div>
      <Select.Portal>
        <Select.Positioner sideOffset={4} {...stylex.props(s.positioner)}>
          <Select.Popup {...stylex.props(s.popup)}>
            <Select.List>
              {items.map((item) => (
                <Select.Item key={item.value} value={item.value} {...stylex.props(s.item)}>
                  <Select.ItemText>{item.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
