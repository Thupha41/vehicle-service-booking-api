import { DateTime } from 'luxon';

interface BusinessHours {
  timezone: string;
  opensAt: string | null;
  closesAt: string | null;
}

export function isWithinBusinessHours(startsAt: Date, endsAt: Date, hours: BusinessHours): boolean {
  if (!hours.opensAt || !hours.closesAt) {
    return false;
  }

  const localStart = DateTime.fromJSDate(startsAt, { zone: 'utc' }).setZone(hours.timezone);
  const localEnd = DateTime.fromJSDate(endsAt, { zone: 'utc' }).setZone(hours.timezone);

  if (!localStart.isValid || !localEnd.isValid || !localStart.hasSame(localEnd, 'day')) {
    return false;
  }

  const [openHour, openMinute, openSecond = 0] = hours.opensAt.split(':').map(Number);
  const [closeHour, closeMinute, closeSecond = 0] = hours.closesAt.split(':').map(Number);
  const opens = localStart.startOf('day').set({
    hour: openHour,
    minute: openMinute,
    second: openSecond,
  });
  const closes = localStart.startOf('day').set({
    hour: closeHour,
    minute: closeMinute,
    second: closeSecond,
  });

  return localStart >= opens && localEnd <= closes;
}
