// Single client-side password policy. It mirrors the Supabase Auth settings in both
// supabase/config.toml files (minimum_password_length + password_requirements =
// "lower_upper_letters_digits_symbols"); the server stays authoritative.
export const PASSWORD_MIN_LENGTH = 10;

// The symbol set GoTrue accepts for the "symbols" requirement class.
const SYMBOLS = '!@#$%^&*()_+-=[]{};\'\\:"|<>?,./`~';

export type PasswordIssue =
  | 'tooShort'
  | 'missingLowercase'
  | 'missingUppercase'
  | 'missingDigit'
  | 'missingSymbol';

/**
 * Failed rules for a candidate password, empty when it satisfies the policy. The value is never
 * trimmed: leading/trailing whitespace is part of the password. Length counts code points.
 */
export function getPasswordIssues(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (Array.from(password).length < PASSWORD_MIN_LENGTH) issues.push('tooShort');
  if (!/[a-z]/.test(password)) issues.push('missingLowercase');
  if (!/[A-Z]/.test(password)) issues.push('missingUppercase');
  if (!/[0-9]/.test(password)) issues.push('missingDigit');
  if (!Array.from(password).some((character) => SYMBOLS.includes(character))) {
    issues.push('missingSymbol');
  }
  return issues;
}

export function isPasswordValid(password: string): boolean {
  return getPasswordIssues(password).length === 0;
}
