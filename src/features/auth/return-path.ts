const DEFAULT_RETURN_PATH = '/dashboard';
const MAX_RETURN_PATH_LENGTH = 2048;

export function normalizeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_RETURN_PATH_LENGTH)
    return DEFAULT_RETURN_PATH;
  // Decode only the pathname. Encoded query/fragment delimiters are user data.
  const suffixStart = value.search(/[?#]/);
  const encodedPath = suffixStart === -1 ? value : value.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? '' : value.slice(suffixStart);
  let path: string;
  let decodedSuffix: string;
  try {
    path = decodeURIComponent(encodedPath);
    decodedSuffix = decodeURIComponent(suffix);
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  if (
    path.length + suffix.length > MAX_RETURN_PATH_LENGTH ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    Array.from(path + decodedSuffix).some(
      (character) =>
        character === '\\' ||
        character.charCodeAt(0) < 32 ||
        (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159)
    )
  )
    return DEFAULT_RETURN_PATH;
  let pathname: string;
  try {
    pathname = new URL(path, 'https://app.local').pathname.replace(/\/+$/, '') || '/';
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  if (
    /%[0-9a-f]{2}/i.test(pathname) ||
    /^\/(?:login|onboarding)(?:\/|$)/i.test(pathname) ||
    /^\/auth\/callback(?:\/|$)/i.test(pathname)
  )
    return DEFAULT_RETURN_PATH;
  return encodedPath + suffix;
}
