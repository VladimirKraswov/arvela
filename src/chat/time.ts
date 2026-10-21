// Intl formatters allocate native ICU state. Reuse the finite set across streaming renders.
let cached: {clock:Intl.DateTimeFormat;day:Intl.DateTimeFormat;year:Intl.DateTimeFormat;exact:Intl.DateTimeFormat} | undefined;
function formats() {
  return cached ??= {
    clock:new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}),
    day:new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'}),
    year:new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}),
    exact:new Intl.DateTimeFormat('ru-RU',{dateStyle:'full',timeStyle:'medium'}),
  };
}
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
  return (new Date(value).getFullYear() !== new Date(now).getFullYear() ? formats().year : formats().day).format(value);
}
export function messageTime(value: number, now = Date.now()): string {
  if (!valid(value)) return '';
  const time = formats().clock.format(value);
  return dayKey(value) === dayKey(now) ? time : `${dayLabel(value, now).toLocaleLowerCase('ru-RU')}, ${time}`;
}
export function exactTime(value: number): string {
  return valid(value) ? formats().exact.format(value) : '';
}
