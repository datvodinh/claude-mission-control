// The arithmetic behind the band and the pane: how full the context is and
// how many turns are left before auto-compact, what the session burns
// per hour, and whether each rate-limit window is on pace to last.

import type { Limit, Reading, Sample } from '../types'
import { clock, limitInfo, money, span, when } from './format'

export type Tone = 'ok' | 'warn' | 'bad' | 'muted'

// ── Context ───────────────────────────────────────────────────────────────

export type Fill = {
  tokens: number | null
  window: number | null
  /** Shares of the window, 0 to 1: what is used, and where auto-compact runs. */
  used: number | null
  compactAt: number | null
  compactTokens: number | null
  /** Average growth per turn over the recent turns, in tokens. */
  perTurn: number | null
  /** Whole turns left before auto-compact at that pace. */
  turnsLeft: number | null
  tone: Tone
}

const RECENT_TURNS = 6

export function fillOf(reading: Reading | null, turns: readonly number[]): Fill {
  const context = reading?.context ?? null
  const window = context?.window ?? null
  const tokens = context?.tokens ?? null
  const compactTokens = reading?.compactAt ?? null
  const share = (count: number | null) => (count === null || window === null || window <= 0 ? null : Math.min(1, count / window))

  const growth: number[] = []
  for (let i = 1; i < turns.length; i++) {
    const delta = (turns[i] ?? 0) - (turns[i - 1] ?? 0)
    if (delta > 0) growth.push(delta)
  }
  const recent = growth.slice(-RECENT_TURNS)
  const perTurn = recent.length === 0 ? null : recent.reduce((sum, one) => sum + one, 0) / recent.length
  const turnsLeft =
    tokens !== null && compactTokens !== null && perTurn !== null && perTurn > 0 ? Math.max(0, Math.floor((compactTokens - tokens) / perTurn)) : null

  const ratio = tokens === null ? 0 : compactTokens !== null ? tokens / compactTokens : (share(tokens) ?? 0)
  const tone: Tone = ratio >= 0.9 ? 'bad' : ratio >= 0.75 ? 'warn' : 'ok'

  return { tokens, window, used: share(tokens), compactAt: share(compactTokens), compactTokens, perTurn, turnsLeft, tone }
}

// ── Spend ─────────────────────────────────────────────────────────────────

/** Dollars per hour over the last half hour of samples, once there are five minutes of them. */
export function burnOf(samples: readonly Sample[], now: number): number | null {
  const priced = samples.filter(one => one.costUsd !== null && now - one.at <= 30 * 60_000)
  const first = priced[0]
  const last = priced[priced.length - 1]
  if (first === undefined || last === undefined || first.costUsd === null || last.costUsd === null) return null
  const hours = (last.at - first.at) / 3_600_000
  if (hours < 5 / 60) return null
  return Math.max(0, (last.costUsd - first.costUsd) / hours)
}

export function spendLine(reading: Reading | null, samples: readonly Sample[], now: number): string | null {
  const cost = reading?.costUsd ?? null
  if (cost === null) return null
  const burn = burnOf(samples, now)
  return burn === null ? money(cost) : `${money(cost)} · ${money(burn)}/h`
}

// ── Rate-limit windows ────────────────────────────────────────────────────

export type Pace = {
  kind: string
  label: string
  percent: number
  /** How much of the window's time has gone, as a percent; null when not known. */
  elapsed: number | null
  /** Where it would stand at the reset at the recent rate. */
  projected: number | null
  verdict: string
  tone: Tone
  resets: string | null
}

export function paceOf(limit: Limit, samples: readonly Sample[], now: number): Pace {
  const { label, hours } = limitInfo(limit.kind)
  const resetAt = limit.resetsAt === null ? Number.NaN : Date.parse(limit.resetsAt)
  const hasReset = !Number.isNaN(resetAt) && resetAt > now
  const resets = hasReset ? when(resetAt, now) : null
  const base = { kind: limit.kind, label, percent: limit.percent, resets }

  if (limit.percent >= 100) {
    return { ...base, elapsed: null, projected: null, verdict: resets === null ? 'limit reached' : `limit reached · back ${resets}`, tone: 'bad' }
  }
  if (hours === null || !hasReset) {
    return { ...base, elapsed: null, projected: null, verdict: resets === null ? 'used' : `resets ${resets}`, tone: limit.percent >= 80 ? 'warn' : 'muted' }
  }

  const length = hours * 3_600_000
  const start = resetAt - length
  const gone = clampNumber((now - start) / length, 0, 1)
  const left = resetAt - now

  // The recent rate, from this session's samples of the 5-hour window; else
  // the window's own average since it opened.
  let rate: number | null = null
  if (limit.kind === 'five_hour') {
    const recent = samples.filter(one => one.fiveHour !== null && now - one.at <= 45 * 60_000 && one.at >= start)
    const first = recent[0]
    const last = recent[recent.length - 1]
    if (first !== undefined && last !== undefined && first.fiveHour !== null && last.fiveHour !== null && last.at - first.at >= 10 * 60_000) {
      rate = Math.max(0, (last.fiveHour - first.fiveHour) / (last.at - first.at))
    }
  }
  if (rate === null && now > start) rate = limit.percent / (now - start)
  const projected = rate === null ? null : limit.percent + rate * left

  if (projected !== null && rate !== null && rate > 0 && projected >= 100) {
    const outAt = now + (100 - limit.percent) / rate
    return { ...base, elapsed: gone * 100, projected, verdict: `out ~${clock(outAt)} · resets ${resets}`, tone: 'bad' }
  }
  if (projected !== null && projected >= 85) {
    return { ...base, elapsed: gone * 100, projected, verdict: `tight · ~${Math.round(projected)}% by reset`, tone: 'warn' }
  }
  return {
    ...base,
    elapsed: gone * 100,
    projected,
    verdict: `on pace · resets ${hours <= 24 ? `in ${span(left)}` : resets}`,
    tone: 'ok',
  }
}

function clampNumber(n: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, n))
}
