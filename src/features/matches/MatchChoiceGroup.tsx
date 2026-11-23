import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { createMatchStyles as s } from './create-match.styles';

export type MatchChoice = { value: string; label: string };

/**
 * Single-choice control rendered as the frame segmented control or pill chips. Base UI owns the
 * radiogroup semantics (arrow-key roving focus, Space to select); a value that matches no option
 * leaves every choice unchecked, so a custom value typed elsewhere never reads as a preset.
 */
export function MatchChoiceGroup({
  legend,
  value,
  choices,
  onChange,
  variant
}: {
  legend: string;
  value: string;
  choices: readonly MatchChoice[];
  onChange: (value: string) => void;
  variant: 'segmented' | 'chips';
}) {
  const legendId = useId();
  const chips = variant === 'chips';
  return (
    <div {...stylex.props(s.choiceGroup)}>
      <span id={legendId} {...stylex.props(s.choiceLabel)}>
        {legend}
      </span>
      <RadioGroup
        value={value}
        aria-labelledby={legendId}
        onValueChange={(next) => {
          const choice = choices.find((candidate) => candidate.value === next);
          if (choice) onChange(choice.value);
        }}
        {...stylex.props(chips ? s.chips : s.segmented)}
      >
        {choices.map((choice) => (
          <Radio.Root
            key={choice.value}
            value={choice.value}
            {...stylex.props(chips ? s.choiceChip : s.choiceSegment)}
          >
            {chips && choice.value === value && (
              <span aria-hidden="true" {...stylex.props(s.choiceCheck)}>
                ✓
              </span>
            )}
            {choice.label}
          </Radio.Root>
        ))}
      </RadioGroup>
    </div>
  );
}
