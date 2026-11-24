// Glyphs summarize notice kind, not current match state. Text remains the accessible source.
export function notificationGlyph(kind: string, category: string) {
  switch (kind) {
    case 'match_registration_approved':
    case 'match_registration_playing':
    case 'match_registration_quartet_complete':
      return { symbol: '✓', tone: 'positive' } as const;
    case 'match_registration_promoted':
    case 'level_review_approved':
      return { symbol: '↑', tone: 'positive' } as const;
    case 'match_registration_requested':
      return { symbol: '?', tone: 'neutral' } as const;
    case 'match_registration_rejected':
      return { symbol: '×', tone: 'danger' } as const;
    case 'match_registration_expired':
      return { symbol: '■', tone: 'neutral' } as const;
    default:
      return category === 'results'
        ? ({ symbol: '◷', tone: 'warning' } as const)
        : ({ symbol: category === 'community' ? '●' : '#', tone: 'neutral' } as const);
  }
}
