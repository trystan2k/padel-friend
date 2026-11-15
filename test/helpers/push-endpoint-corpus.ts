// Shared JS/SQL RPC corpus: normalization tricks must never expand supported authorities.
export const acceptedPushEndpoints = [
  'https://fcm.googleapis.com?token=a@b',
  'https://fcm.googleapis.com?token=user:pass@host/path',
  'https://fcm.googleapis.com/fcm/send/a',
  'https://fcm.googleapis.com:443/send/a?key=abc',
  'https://updates.push.services.mozilla.com/wpush/v2/a',
  'https://a.push.services.mozilla.com/a',
  'https://web.push.apple.com/a',
  'https://a.web.push.apple.com/a'
];

export const rejectedPushEndpoints = [
  'not-a-url',
  'http://fcm.googleapis.com/a',
  'https://fcm.googleapis.com:444/a',
  'https://u:p@fcm.googleapis.com/a',
  'https://fcm.googleapis.com@evil.test/a',
  'https://127.0.0.1/a',
  'https://[::1]/a',
  'https://10.0.0.1/a',
  'https://169.254.169.254/latest/meta-data',
  'https://fcm.googleapis.com.evil.test/a',
  'https://a.b.web.push.apple.com/a',
  'https://push.services.mozilla.com/a',
  'https://evil.test/a',
  'https://web.push.apple.com/a#secret',
  'https://web.push.apple.com/a#',
  'https://fcm.googleapis.com./a',
  'https://%66cm.googleapis.com/a',
  'https://ｆcm.googleapis.com/a',
  'https://fcm。googleapis.com/a',
  'https://fcm.googleapis.com\\@evil.test/a',
  'https://fcm.googleapis.com/a\\b',
  'https://fcm.googleapis.com/\na',
  ' https://fcm.googleapis.com/a',
  'https://fcm.googleapis.com/a\n',
  'https://fcm.googleapis.com/a\u0000',
  'https://a.notify.windows.com/a',
  'https://fcm.googleapis.com:0443/a',
  'https://fcm.googleapis.com:invalid/a',
  `https://fcm.googleapis.com/${'x'.repeat(2048)}`
];
