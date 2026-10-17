const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timePattern = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function validateLocalDate(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_MATCH_DATE');
  const match = datePattern.exec(value);
  if (!match) throw new Error('INVALID_MATCH_DATE');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== value || year < 1 || month > 12 || day > 31)
    throw new Error('INVALID_MATCH_DATE');
  return value;
}

export function validateLocalTime(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_MATCH_TIME');
  const match = timePattern.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? 0) > 59)
    throw new Error('INVALID_MATCH_TIME');
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

export function localMatchInstant(
  date: string,
  time: string,
  timezone: string
): { instant: Date; offset: string } {
  validateLocalDate(date);
  validateLocalTime(time);
  const target = `${date}T${validateLocalTime(time)}`;
  const guess = new Date(`${date}T${time}Z`).getTime();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta++) {
    const instant = guess + delta * 60 * 60 * 1000;
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map(({ type, value }) => [type, value])
    );
    const shown = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    offsets.add(Date.parse(`${shown}Z`) - instant);
  }
  const matches = [...offsets]
    .map((offset) => guess - offset)
    .filter((instant) => {
      const parts = Object.fromEntries(
        formatter.formatToParts(instant).map(({ type, value }) => [type, value])
      );
      return (
        `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` ===
        target
      );
    })
    .sort((a, b) => a - b);
  if (!matches.length) throw new Error('INVALID_MATCH_LOCAL_TIME');
  const earliest = matches[0];
  if (earliest === undefined) throw new Error('INVALID_MATCH_LOCAL_TIME');
  const instant = new Date(earliest);
  const offsetMinutes = Math.round((Date.parse(`${target}Z`) - instant.getTime()) / 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return {
    instant,
    offset: `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
  };
}
