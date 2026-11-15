// Keep grammar mirrored in register_my_push_subscription and exercised by shared test corpus.
// Raw ASCII authority prevents URL normalization (encoded/unicode hosts, backslashes, whitespace)
// from turning an ambiguous input into a supported host. WNS deliberately remains unsupported.
const endpointPattern = new RegExp(
  String.raw`^https://(fcm\.googleapis\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|([a-z0-9-]+\.)?web\.push\.apple\.com)(:443)?([/?][!-~]*)?$`
);

export function validatePushEndpoint(endpoint: string): void {
  if (
    endpoint.length > 2048 ||
    !endpointPattern.test(endpoint) ||
    /[#\\\\\s]/.test(endpoint) ||
    /[^\x21-\x7e]/.test(endpoint)
  ) {
    throw new Error('PUSH_INVALID_ENDPOINT');
  }
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) {
    throw new Error('PUSH_INVALID_ENDPOINT');
  }
}
