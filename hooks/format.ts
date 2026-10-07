// Plain formatting: numbers, money, durations, model names, short text.

export function tokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`
  if (count >= 10_000) return `${Math.round(count / 1000)}k`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

export function money(usd: number): string {
  if (usd >= 100) return `$${Math.round(usd)}`
  return `$${usd.toFixed(2)}`
}

/** `42s`, `3m`, `1h 5m`, `2d`. */
export function span(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
  return `${Math.round(hours / 24)}d`
}

export function clock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** `15:40` today, else `Mon 09:00`. */
export function when(at: number, now: number): string {
  const day = new Date(at)
  const today = new Date(now)
  const isToday = day.getFullYear() === today.getFullYear() && day.getMonth() === today.getMonth() && day.getDate() === today.getDate()
  return isToday ? clock(at) : `${DAYS[day.getDay()] ?? ''} ${clock(at)}`
}

const LIMITS: Record<string, { label: string; hours: number | null }> = {
  five_hour: { label: '5-hour', hours: 5 },
  seven_day: { label: 'Weekly', hours: 7 * 24 },
  seven_day_opus: { label: 'Weekly Opus', hours: 7 * 24 },
  spend_limit: { label: 'Spend', hours: null },
}

export function limitInfo(kind: string): { label: string; hours: number | null } {
  const known = LIMITS[kind]
  if (known !== undefined) return known
  const words = kind.replace(/_/g, ' ')
  return { label: words.charAt(0).toUpperCase() + words.slice(1), hours: null }
}

/** `claude-opus-5-5[1m]` → `Opus 5.5`; anything else as given. */
export function prettyModel(id: string): string {
  const found = /(opus|sonnet|haiku|fable)[-_ ]?(\d+)(?:[-_.](\d+))?/i.exec(id)
  if (found === null) return id
  const family = found[1] ?? ''
  const name = family.charAt(0).toUpperCase() + family.slice(1).toLowerCase()
  const version = found[3] === undefined || found[3].length > 2 ? found[2] : `${found[2]}.${found[3]}`
  return `${name} ${version}`
}

export function shorten(text: string, width: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= width ? line : `${line.slice(0, Math.max(1, width - 1))}…`
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
}
