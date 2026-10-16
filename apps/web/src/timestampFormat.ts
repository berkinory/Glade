// Chromium's UI language decides the clock otherwise, which ignores the system's 24-hour setting.
const hourCycle = window.desktopBridge?.getHourCycle() ?? undefined;

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  hourCycle,
});

const timeWithSecondsFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hourCycle,
});

export function formatTimestamp(isoDate: string): string {
  return timeWithSecondsFormatter.format(new Date(isoDate));
}

const dayLabelFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDayLabelFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = JSON.stringify(options);
  const cachedFormatter = dayLabelFormatterCache.get(cacheKey);
  if (cachedFormatter) {
    return cachedFormatter;
  }

  const formatter = new Intl.DateTimeFormat(undefined, options);
  dayLabelFormatterCache.set(cacheKey, formatter);
  return formatter;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function calendarDaysBetween(from: Date, to: Date): number {
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toMidnight.getTime() - fromMidnight.getTime()) / DAY_IN_MS);
}

export function formatDayAwareTimestamp(isoDate: string, now: Date = new Date()): string {
  const date = new Date(isoDate);
  const time = timeFormatter.format(date);
  if (isSameCalendarDay(date, now)) {
    return time;
  }

  const daysAgo = calendarDaysBetween(date, now);
  const dayLabel =
    daysAgo > 0 && daysAgo < 7
      ? getDayLabelFormatter({ weekday: "long" }).format(date)
      : getDayLabelFormatter({
          month: "short",
          day: "numeric",
          ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
        }).format(date);
  return `${dayLabel} ${time}`;
}
