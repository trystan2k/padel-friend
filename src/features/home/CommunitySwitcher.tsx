import { Select } from '@base-ui/react/select';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import type { HomeCommunity } from './home-contracts';
import { homeStyles as s } from './home.styles';

/** Selecting only changes which community Home shows; it never grants access to anything. */
export function CommunitySwitcher({
  communities,
  value,
  onSelect
}: {
  communities: HomeCommunity[];
  value: string;
  onSelect: (communityId: string) => void;
}) {
  const { t } = useTranslation();
  const items = communities.map((community) => ({ value: community.id, label: community.name }));
  return (
    <Select.Root
      items={items}
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string' && next !== value) onSelect(next);
      }}
    >
      <div {...stylex.props(s.switcher)}>
        <Select.Label {...stylex.props(s.switcherLabel)}>{t('home.switcherLabel')}</Select.Label>
        <Select.Trigger {...stylex.props(s.trigger)}>
          <Select.Value />
          <Select.Icon aria-hidden="true">▾</Select.Icon>
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
