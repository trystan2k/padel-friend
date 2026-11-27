// Section layout of the privacy policy. Copy lives in the locale files under
// `privacy.<id>.title`, `privacy.<id>.p<n>` (paragraphs) and `privacy.<id>.i<n>` (list items).
export const PRIVACY_CONTACT_EMAIL = 'trystan2k@gmail.com';

// ISO date of the last policy change; shown localized at the top of the page.
export const PRIVACY_UPDATED_AT = '2026-11-27';

export type PrivacySection = { id: string; paragraphs: number; items: number };

// The policy is published as a truthful description of how the service works today (every claim is
// backed by the implemented flow or by dated repository/catalog evidence; see
// docs/account-deletion-design.md). That is NOT a legal sign-off: the external legal review is pending
// and owner-owned. While this stays false the page shows a localized "no external legal review yet"
// note. Set it to true only when the owner records that the review has happened; never infer it from
// the policy being public, and never cite this flag as proof of compliance.
export const PRIVACY_LEGAL_REVIEW_COMPLETED = false;

export const PRIVACY_SECTIONS: readonly PrivacySection[] = [
  { id: 'who', paragraphs: 1, items: 0 },
  { id: 'collect', paragraphs: 1, items: 7 },
  { id: 'invitees', paragraphs: 2, items: 0 },
  { id: 'use', paragraphs: 1, items: 5 },
  { id: 'legalBases', paragraphs: 2, items: 6 },
  { id: 'google', paragraphs: 2, items: 0 },
  { id: 'sharing', paragraphs: 1, items: 6 },
  { id: 'photos', paragraphs: 1, items: 0 },
  { id: 'advertising', paragraphs: 1, items: 0 },
  { id: 'providers', paragraphs: 1, items: 5 },
  { id: 'transfers', paragraphs: 2, items: 3 },
  { id: 'retention', paragraphs: 3, items: 0 },
  { id: 'security', paragraphs: 1, items: 0 },
  { id: 'requests', paragraphs: 4, items: 0 },
  { id: 'deletion', paragraphs: 1, items: 5 },
  { id: 'residual', paragraphs: 3, items: 0 },
  { id: 'rights', paragraphs: 3, items: 0 },
  { id: 'age', paragraphs: 1, items: 0 },
  { id: 'changes', paragraphs: 1, items: 0 },
  { id: 'contact', paragraphs: 1, items: 0 }
];
