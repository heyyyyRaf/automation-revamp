/** Display helpers shared by client components (dates are formatted in the viewer's locale). */

const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** "Ran today, 9:40 AM", "Uploaded 5 min ago", "Ran yesterday", "Created Oct 15". */
export function activityLabel(verb: string, at: string | Date, now = new Date()): string {
  const d = new Date(at);
  const minutes = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (minutes < 1) return `${verb} just now`;
  if (minutes < 60) return `${verb} ${minutes} min ago`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startOfToday) return `${verb} today, ${time.format(d)}`;
  if (d >= new Date(startOfToday.getTime() - 86_400_000)) return `${verb} yesterday`;
  return `${verb} ${day.format(d)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
