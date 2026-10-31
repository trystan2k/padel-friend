import {
  displayName,
  estimatedLevel,
  normalizeEmail,
  type AddMatchPlayerInput
} from './match-add-player.validators';

export type AddPlayerFormValues = { name: string; email: string; level: string | null };
export type AddPlayerField = 'name' | 'email' | 'level';
export type AddPlayerFieldErrors = Partial<Record<AddPlayerField, string>>;
export type AddPlayerFields = Pick<
  AddMatchPlayerInput,
  'display_name' | 'email' | 'estimated_level'
>;

const FIELD_ORDER: readonly AddPlayerField[] = ['name', 'email', 'level'];

/** Same rules as validateAddMatchPlayer, reported per field with translation keys. */
export function validateAddPlayerForm(
  values: AddPlayerFormValues
): { ok: true; value: AddPlayerFields } | { ok: false; errors: AddPlayerFieldErrors } {
  const errors: AddPlayerFieldErrors = {};
  const attempt = <T>(field: AddPlayerField, parse: () => T): T | undefined => {
    try {
      return parse();
    } catch {
      errors[field] = `matches.addPlayer.validation.${field}`;
      return undefined;
    }
  };
  const display_name = attempt('name', () => displayName(values.name));
  const email = attempt('email', () => normalizeEmail(values.email));
  const estimated_level = attempt('level', () => estimatedLevel(values.level));
  if (display_name === undefined || email === undefined || estimated_level === undefined)
    return { ok: false, errors };
  return { ok: true, value: { display_name, email, estimated_level } };
}

export function firstInvalidField(errors: AddPlayerFieldErrors): AddPlayerField | null {
  return FIELD_ORDER.find((field) => errors[field]) ?? null;
}
