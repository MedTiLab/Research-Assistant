/** Date maths for the home calendar. Everything stays in local time so a day never drifts by a UTC offset. */

export function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromLocalDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getWeekDates(anchor: Date) {
  const current = startOfDay(anchor);
  const mondayOffset = current.getDay() === 0 ? -6 : 1 - current.getDay();
  const monday = new Date(current);
  monday.setDate(current.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
}

export function getMonthGrid(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const mondayOffset = first.getDay() === 0 ? -6 : 1 - first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() + mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

/** Keeps the day-of-month when stepping between months, so 3/31 → 2月 lands on the last day instead of overflowing. */
export function clampDateToMonth(year: number, month: number, preferredDay: number) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(preferredDay, lastDay));
}

export function formatWeekRange(days: Date[], locale = 'zh-CN') {
  const start = days[0];
  const end = days[days.length - 1];
  const startLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(start);
  if (start.getFullYear() !== end.getFullYear()) {
    return `${startLabel} — ${new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(end)}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${startLabel} — ${new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(end)}`;
  }
  return `${startLabel} — ${new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(end)}`;
}
