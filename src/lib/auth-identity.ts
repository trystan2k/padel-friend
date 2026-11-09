// Decides whether an auth event means the signed-in identity of a mounted private view ended or
// changed (sign-out, or another tab signed in as someone else). Same-user refreshes never retire it.
export function isIdentityReplaced(
  baselineUserId: string | null,
  { event, userId }: { event: string; userId: string | null }
) {
  if (event === 'SIGNED_OUT') return true;
  return baselineUserId !== null && userId !== null && userId !== baselineUserId;
}
