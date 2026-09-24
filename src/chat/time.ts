const valid = (value: number) => Number.isFinite(value) && value > 0 && !Number.isNaN(new Date(value).getTime());
export function dayKey(value: number): string {
  if (!valid(value)) return '';
  const d = new Date(value); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
export function dayLabel(value: number, now = Date.now()): string {
  if (!valid(value)) return '';
  if (dayKey(value) === dayKey(now)) return 'Сегодня';
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(value) === dayKey(yesterday.getTime())) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long',
    ...(new Date(value).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' as const } : {}) }).format(value);
}
export function messageTime(value: number, now = Date.now()): string {
  if (!valid(value)) return '';
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(value);
  return dayKey(value) === dayKey(now) ? time : `${dayLabel(value, now).toLocaleLowerCase('ru-RU')}, ${time}`;
}
export function exactTime(value: number): string {
  return valid(value) ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full', timeStyle: 'medium' }).format(value) : '';
}
