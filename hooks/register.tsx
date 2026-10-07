// Mission control: every agent of the session as a living Clawd, how full the
// context window is, and the budget's pace. The band above the prompt keeps
// the crew in view, nothing more; the pane (/mission) has the stage, the
// crew, the context and the budget.
//
// The hooks keep the facts in `$.state` (who is doing what, the readings);
// the band and the pane draw them, and the surface module (./clawd.tsx)
// animates the Clawds between redraws.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, AgentSpawnInput, EngineInterface, ModelUsage, Register, TurnCompleteInput } from 'claude-code'

import type { Actor, Member, Mood, Reading, StageProps, StripProps, Walker, Where } from '../types'
import { fillOf, paceOf, spendLine } from './budget'
import type { Fill, Tone } from './budget'
import { plural, prettyModel, shorten, span, tokens } from './format'
import { ASKING, DELEGATING, badgeOf, captionOf, detailOf, verbOf } from './tools'
import { Band, Pane } from './view'
import type { ContextView, CrewRow, Kit, Spotlight } from './view'

type Engine = EngineInterface

const PANE = 'mission-control'
const TITLE = 'Mission control'

const crew = atom({ plugin: 'mission-control', key: 'crew' } as const, [])
const selected = atom({ plugin: 'mission-control', key: 'selected' } as const, null)
const reading = atom({ plugin: 'mission-control', key: 'reading' } as const, null)
const turns = atom({ plugin: 'mission-control', key: 'turns' } as const, [])
const samples = atom({ plugin: 'mission-control', key: 'samples' } as const, [])
const isBandHidden = atom({ plugin: 'mission-control', key: 'isBandHidden' } as const, false)

/** The app's own subagent colours, in the order new subagents take them. */
const PALETTE = [
  'blue_FOR_SUBAGENTS_ONLY',
  'green_FOR_SUBAGENTS_ONLY',
  'purple_FOR_SUBAGENTS_ONLY',
  'pink_FOR_SUBAGENTS_ONLY',
  'cyan_FOR_SUBAGENTS_ONLY',
  'yellow_FOR_SUBAGENTS_ONLY',
  'red_FOR_SUBAGENTS_ONLY',
]

const MAIN = 'main'
const ENDED: readonly Mood[] = ['done', 'failed', 'stopped']
const BUSY: readonly Mood[] = ['working', 'asking', 'delegating']
const SLEEP_AFTER_MS = 3 * 60_000
const OFF_STAGE_AFTER_MS = 5 * 60_000
/** How long a subagent that ended stays on the band's strip, to play it out. */
const OFF_STRIP_AFTER_MS = 20_000
/** The band's Clawds on the desktop: as tall as a hover's bubble beside them, in lines, and Claude's own room, in ch. */
const STRIP_LH = 1.5
const STRIP_MAIN_CH = 6.3
const KEEP_MEMBERS = 24
const BEAT_MS = 15_000

/** The engine's own plumbing, not work worth showing: a subagent handing its report back. */
const INTERNAL = new Set(['SubagentHandback', 'StructuredOutput'])

// Module state: rebuilt on every reload, and nothing is drawn from it.
const inFlight = new Map<string, number>()
/** Each subagent's latest response, in tokens: its context as it stands. */
const lastSize = new Map<string, number>()
let beats = 0

const sizeOf = (usage: ModelUsage) => usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens

// ── The crew ──────────────────────────────────────────────────────────────

function newMember(id: string, type: string, task: string, color: string, at: number, extra: Partial<Member> = {}): Member {
  return {
    id,
    type,
    task,
    color,
    mood: 'thinking',
    since: at,
    tool: null,
    detail: null,
    calls: 0,
    tokens: null,
    model: null,
    joinedAt: at,
    startedAt: at,
    endedAt: null,
    isBackground: false,
    isTeammate: false,
    recent: [],
    ...extra,
  }
}

const colorFor = (index: number) => PALETTE[index % PALETTE.length] ?? 'blue_FOR_SUBAGENTS_ONLY'

/** Keeps Claude and the latest subagents, letting the oldest finished ones go first. */
function trim(list: readonly Member[]): Member[] {
  if (list.length <= KEEP_MEMBERS) return [...list]
  const ended = list.filter(one => one.id !== MAIN && ENDED.includes(one.mood)).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
  const drop = new Set(ended.slice(0, list.length - KEEP_MEMBERS).map(one => one.id))
  return list.filter(one => !drop.has(one.id))
}

function moodOfStatus(status: AgentInfo['status'], now: Mood): Mood {
  switch (status) {
    case 'completed':
      return ENDED.includes(now) ? now : 'done'
    case 'failed':
      return 'failed'
    case 'killed':
      return 'stopped'
    case 'waiting':
      return 'asking'
    case 'idle':
      return 'idle'
    case 'pending':
    case 'running':
      return now === 'idle' || now === 'asking' ? 'thinking' : now
  }
}

async function ensureMain($: Engine): Promise<void> {
  const [at, model] = await Promise.all([$.clock.now(), $.session.model()])
  await update($, crew, list =>
    list.some(one => one.id === MAIN)
      ? list.map(one => (one.id === MAIN ? { ...one, model } : one))
      : [newMember(MAIN, 'Claude', '', 'clawd_body', at, { mood: 'idle', model }), ...list],
  )
}

async function toolStarted($: Engine, who: string, tool: string, detail: string | null): Promise<void> {
  try {
    const at = await $.clock.now()
    inFlight.set(who, (inFlight.get(who) ?? 0) + 1)
    const mood: Mood = ASKING.has(tool) ? 'asking' : DELEGATING.has(tool) ? 'delegating' : 'working'
    await update($, crew, list =>
      list.map(one => {
        if (one.id !== who) return one
        return {
          ...one,
          mood,
          since: one.mood === mood ? one.since : at,
          tool,
          detail,
          calls: one.calls + 1,
          recent: [...one.recent, { tool, detail, at }].slice(-6),
        }
      }),
    )
  } catch {
    // The bookkeeping never stands in a tool's way.
  }
}

async function toolEnded($: Engine, who: string): Promise<void> {
  try {
    const left = Math.max(0, (inFlight.get(who) ?? 1) - 1)
    inFlight.set(who, left)
    if (left > 0) return
    const at = await $.clock.now()
    await update($, crew, list =>
      list.map((one): Member => (one.id === who && BUSY.includes(one.mood) ? { ...one, mood: 'thinking', since: at, tool: null } : one)),
    )
  } catch {
    // As above.
  }
}

/**
 * A turn the engine began rather than you: a background task's notice, a
 * message relayed from another session. Its text is markup, not an ask.
 */
const isEngineText = (text: string) => /^\s*<[a-z][\w-]*[\s/>]/i.test(text) || text.startsWith('Another Claude session sent a message')

async function turnStarted($: Engine, text: string): Promise<void> {
  try {
    const at = await $.clock.now()
    inFlight.set(MAIN, 0)
    const prompt = isEngineText(text) ? '' : text.trim()
    await update($, crew, list =>
      list.map((one): Member =>
        one.id === MAIN
          ? { ...one, mood: 'thinking', since: at, task: prompt === '' ? one.task : shorten(prompt, 240), calls: 0, startedAt: at, endedAt: null, tool: null, detail: null }
          : one,
      ),
    )
  } catch {
    // As above.
  }
}

async function turnEnded($: Engine, e: TurnCompleteInput): Promise<void> {
  try {
    const at = await $.clock.now()
    if (e.agentId === undefined) {
      inFlight.set(MAIN, 0)
      await update($, crew, list => list.map((one): Member => (one.id === MAIN ? { ...one, mood: 'idle', since: at, tool: null, endedAt: at } : one)))
      await refresh($, true, true)
      return
    }
    const id = e.agentId
    const member = (await read($, crew)).find(one => one.id === id)
    if (member === undefined) return
    inFlight.delete(id)
    // What the run took, as Claude Code counts it: the context its last
    // response stood on. A turn's usage sums every response, re-reading the
    // same context each time, so without a step seen it counts each token once.
    const usage = e.usage
    const used =
      lastSize.get(id) ?? (usage === undefined ? null : usage.input_tokens + usage.cache_creation_input_tokens + usage.output_tokens)
    lastSize.delete(id)
    const mood: Mood = member.isTeammate ? 'idle' : e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
    await update($, crew, list =>
      list.map((one): Member =>
        one.id === id ? { ...one, mood, since: at, tool: null, endedAt: member.isTeammate ? null : at, tokens: used ?? one.tokens } : one,
      ),
    )
  } catch {
    // As above.
  }
}

async function joined($: Engine, e: AgentSpawnInput, agentId: string, model: string): Promise<void> {
  try {
    const at = await $.clock.now()
    await update($, crew, list => {
      if (list.some(one => one.id === agentId)) return list
      const subs = list.filter(one => one.id !== MAIN).length
      const type = e.name ?? e.subagentType
      return trim([
        ...list,
        newMember(agentId, type, e.description, colorFor(subs), at, { model, isBackground: e.background, isTeammate: e.isTeammate === true }),
      ])
    })
  } catch {
    // As above.
  }
}

/** Squares the crew with the engine's own list: statuses, and agents started before this load. */
async function reconcile($: Engine): Promise<void> {
  try {
    const [agents, at] = await Promise.all([$.agent.list(), $.clock.now()])
    await update($, crew, list => {
      const known = new Set(list.map(one => one.id))
      const next = list.map(one => {
        const info = agents.find(agent => agent.id === one.id)
        if (info === undefined || one.id === MAIN) return one
        const mood = moodOfStatus(info.status, one.mood)
        if (mood === one.mood) return one
        return { ...one, mood, since: at, endedAt: ENDED.includes(mood) ? (one.endedAt ?? at) : null }
      })
      const subs = next.filter(one => one.id !== MAIN).length
      const fresh = agents
        .filter(agent => !known.has(agent.id))
        .map((agent, i) =>
          newMember(agent.id, agent.name ?? agent.type, agent.description, colorFor(subs + i), at, {
            mood: moodOfStatus(agent.status, 'thinking'),
            isTeammate: agent.teammateId !== undefined,
          }),
        )
      return fresh.length === 0 && next.every((one, i) => one === list[i]) ? list : trim([...next, ...fresh])
    })
  } catch {
    // The list is a nicety; a failed read waits for the next beat.
  }
}

// ── Readings ──────────────────────────────────────────────────────────────

async function refresh($: Engine, withBreakdown: boolean, isTurnEnd = false): Promise<void> {
  try {
    const usage = await $.session.usage(withBreakdown ? { breakdown: 'summary' } : {})
    const [model, at, before] = await Promise.all([$.session.model(), $.clock.now(), read($, reading)])
    const live = usage.context
    const breakdown = live.breakdown
    // The window /context measures against: the model's, or a compaction
    // window set smaller. Its breakdown comes now and then; until the next,
    // the last one's window stands.
    const window = breakdown?.rawMaxTokens ?? before?.context?.window ?? live.window
    // Before the window's first response (a fresh session, a compaction just
    // run) only /context's estimate has a figure: what the next one carries.
    const used = live.tokens !== undefined && live.tokens > 0 ? live.tokens : (breakdown?.totalTokens ?? before?.context?.tokens ?? 0)
    const context = used <= 0 || window <= 0 ? null : { tokens: used, window, percent: (used / window) * 100 }
    const next: Reading = {
      at,
      model,
      startedAt: usage.startedAt,
      context,
      compactAt:
        breakdown === undefined
          ? (before?.compactAt ?? null)
          : breakdown.isAutoCompactEnabled
            ? (breakdown.autoCompactThreshold ?? null)
            : null,
      categories:
        breakdown === undefined
          ? (before?.categories ?? [])
          : breakdown.categories.flatMap(one =>
              one.kind === 'deferred' || one.tokens <= 0 ? [] : [{ name: one.name, tokens: one.tokens, color: one.color, kind: one.kind }],
            ),
      limits: usage.rateLimits.map(one => ({ kind: one.kind, percent: one.percentUsed, resetsAt: one.resetsAt ?? null })),
      costUsd: usage.cost?.usd ?? null,
    }
    await update($, reading, () => next)

    if (isTurnEnd && context !== null) await update($, turns, list => [...list, context.tokens].slice(-40))

    const fiveHour = next.limits.find(one => one.kind === 'five_hour')?.percent ?? null
    await update($, samples, list => [...list.filter(one => at - one.at <= 50 * 60_000), { at, costUsd: next.costUsd, fiveHour }].slice(-240))
  } catch {
    // A reading that fails is retried on the next beat.
  }
}

async function heartbeat($: Engine): Promise<void> {
  beats += 1
  await refresh($, beats % 4 === 0)
  await reconcile($)
}

async function pick($: Engine, id: string): Promise<void> {
  await update($, selected, now => (now === id ? null : id))
}

async function openPane($: Engine): Promise<boolean> {
  void refresh($, true)
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  return opened.isPlaced
}

// ── From facts to what is drawn ───────────────────────────────────────────

function labelOf(member: Member): string {
  if (member.type === 'general-purpose') return 'General'
  return member.type
}

function moodNow(member: Member, now: number): Mood {
  return member.mood === 'idle' && member.id === MAIN && now - member.since > SLEEP_AFTER_MS ? 'sleeping' : member.mood
}

function captionFor(member: Member, now: number, isNarrow = false): string {
  const mood = moodNow(member, now)
  switch (mood) {
    case 'working':
    case 'asking':
    case 'delegating':
      // The bubble names the tool; a subagent's narrow caption keeps the argument.
      if (member.tool === null) return 'working'
      return isNarrow && member.detail !== null ? member.detail : captionOf(member.tool, member.detail)
    case 'thinking':
      return 'thinking…'
    case 'idle':
      return member.id === MAIN ? 'waiting for you' : 'idle'
    case 'sleeping':
      return 'napping'
    case 'done':
      return `done · ${span((member.endedAt ?? now) - member.startedAt)}`
    case 'failed':
      return 'failed'
    case 'stopped':
      return 'stopped'
  }
}

const MOOD_WORD: Record<Mood, string> = {
  working: 'Working',
  thinking: 'Thinking',
  asking: 'Needs you',
  delegating: 'Waiting on the crew',
  idle: 'Idle',
  sleeping: 'Napping',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
}

const MOOD_TONE: Record<Mood, Tone> = {
  working: 'ok',
  thinking: 'ok',
  asking: 'warn',
  delegating: 'muted',
  idle: 'muted',
  sleeping: 'muted',
  done: 'ok',
  failed: 'bad',
  stopped: 'muted',
}

/** Claude first, then the crew at work in the order they joined, then the ones that finished, latest first. */
function lineUp(members: readonly Member[], now: number, isStage: boolean): Member[] {
  const main = members.filter(one => one.id === MAIN)
  const subs = members.filter(one => one.id !== MAIN)
  const busy = subs.filter(one => !ENDED.includes(one.mood)).sort((a, b) => a.startedAt - b.startedAt)
  const ended = subs
    .filter(one => ENDED.includes(one.mood) && (!isStage || now - (one.endedAt ?? now) < OFF_STAGE_AFTER_MS))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  return [...main, ...busy, ...ended]
}

/** How long since it joined; one kept from before join times were kept counts as long ago. */
const joinedMs = (member: Member, now: number) => (typeof member.joinedAt === 'number' ? Math.max(0, now - member.joinedAt) : Number.MAX_SAFE_INTEGER)

function actorOf(member: Member, now: number): Actor {
  return {
    id: member.id,
    name: labelOf(member),
    caption: captionFor(member, now, member.id !== MAIN),
    color: member.color,
    mood: moodNow(member, now),
    ageMs: Math.max(0, now - member.since),
    joinedMs: joinedMs(member, now),
    tool: member.tool === null ? null : badgeOf(member.tool),
    isMain: member.id === MAIN,
  }
}

/** The band's Clawds: Claude, the crew at work in the order they joined, and those just ended, still playing it out. */
function stripOf(members: readonly Member[], now: number, where: Where): StripProps {
  const main = members.filter(one => one.id === MAIN)
  const subs = members
    .filter(one => one.id !== MAIN && (!ENDED.includes(one.mood) || now - (one.endedAt ?? now) < OFF_STRIP_AFTER_MS))
    .sort((a, b) => a.startedAt - b.startedAt)
  const walkers: Walker[] = [...main, ...subs].map(one => ({
    id: one.id,
    name: one.id === MAIN ? 'Claude' : labelOf(one),
    // Claude's is your own last prompt: its bubble leaves it out.
    task: one.id === MAIN ? '' : shorten(one.task, 120),
    doing: captionFor(one, now),
    color: one.color,
    mood: moodNow(one, now),
    ageMs: Math.max(0, now - one.since),
    joinedMs: joinedMs(one, now),
  }))
  return { view: 'strip', surface: where, walkers }
}

/** What the stage says while Claude is alone on it: what became of the crew, if there was one. */
function hintOf(members: readonly Member[]): string | null {
  const done = members.filter(one => one.id !== MAIN && ENDED.includes(one.mood)).length
  return done === 0 ? null : `${plural(done, 'subagent')} done and off the stage · see Crew below`
}

function spotlightOf(member: Member, now: number, isPinned: boolean): Spotlight {
  const mood = moodNow(member, now)
  const facts = [
    member.id === MAIN ? plural(member.calls, 'tool call') + ' this turn' : plural(member.calls, 'tool call'),
    member.tokens === null ? null : `${tokens(member.tokens)} tokens`,
    member.model === null ? null : prettyModel(member.model),
    member.isBackground ? 'in the background' : null,
  ].filter((one): one is string => one !== null)
  return {
    id: member.id,
    name: member.id === MAIN ? 'Claude' : labelOf(member),
    color: member.color,
    status: MOOD_WORD[mood],
    tone: MOOD_TONE[mood],
    elapsed: span((member.endedAt ?? now) - member.startedAt),
    task: member.task === '' ? null : member.task,
    doing: member.tool === null || !BUSY.includes(mood) ? null : { verb: verbOf(member.tool), detail: member.detail },
    facts: facts.join(' · '),
    recent: [...member.recent]
      .reverse()
      .slice(0, 5)
      .map(step => ({ tool: step.tool, detail: step.detail, ago: `${span(now - step.at)} ago` })),
    isPinned,
  }
}

/** The pinned agent, else the newest subagent at work, else Claude. */
function focusOf(members: readonly Member[], pinned: string | null): { member: Member | null; isPinned: boolean } {
  const chosen = pinned === null ? undefined : members.find(one => one.id === pinned)
  if (chosen !== undefined) return { member: chosen, isPinned: true }
  const busy = members.filter(one => one.id !== MAIN && !ENDED.includes(one.mood)).sort((a, b) => b.startedAt - a.startedAt)[0]
  return { member: busy ?? members.find(one => one.id === MAIN) ?? null, isPinned: false }
}

function headlineOf(members: readonly Member[], now: number): string {
  const main = members.find(one => one.id === MAIN)
  const subs = members.filter(one => one.id !== MAIN)
  const busy = subs.filter(one => !ENDED.includes(one.mood)).length
  const done = subs.filter(one => one.mood === 'done').length
  const claude =
    main === undefined
      ? null
      : moodNow(main, now) === 'idle' || moodNow(main, now) === 'sleeping'
        ? 'Claude is waiting for you'
        : main.mood === 'asking'
          ? 'Claude needs you'
          : main.mood === 'delegating'
            ? 'Claude is waiting on the crew'
            : 'Claude is working'
  return [claude, busy === 0 ? null : `${plural(busy, 'subagent')} running`, done === 0 ? null : `${done} done`]
    .filter((one): one is string => one !== null)
    .join(' · ')
}

function compactNote(fill: Fill): { text: string; tone: Tone } | null {
  if (fill.compactTokens === null) return null
  const at = `auto-compact at ${tokens(fill.compactTokens)}`
  if (fill.turnsLeft === null) return { text: at, tone: 'muted' }
  const tone: Tone = fill.turnsLeft <= 2 ? 'bad' : fill.turnsLeft <= 5 ? 'warn' : 'muted'
  return { text: `${at} · ${fill.turnsLeft === 0 ? 'compacts next turn' : `~${plural(fill.turnsLeft, 'turn')} to compact`}`, tone }
}

function contextOf(fill: Fill, current: Reading | null): ContextView {
  const parts = current?.categories ?? []
  const total = parts.reduce((sum, one) => sum + one.tokens, 0)
  return {
    used: fill.tokens === null ? null : tokens(fill.tokens),
    window: fill.window === null ? null : tokens(fill.window),
    compact: compactNote(fill),
    parts:
      total <= 0
        ? []
        : [
            ...parts.filter(one => one.kind === 'used').sort((a, b) => b.tokens - a.tokens),
            // The buffer auto-compact keeps is left out: the compact note says where it starts.
            ...parts.filter(one => one.kind === 'free'),
          ].map(one => ({ name: one.name, share: one.tokens / total, color: one.color, kind: one.kind })),
  }
}

// ── The hooks ─────────────────────────────────────────────────────────────

export const register: Register = on => {
  // One Mission control a session: a second copy of this plugin, from
  // another folder (a working copy beside the installed one), stays out
  // rather than drawing a second band. A reload of this one comes from its
  // own folder, and passes.
  on('plugin.register', async ($, e, next) =>
    e.name === $.plugin.name && e.root !== $.plugin.root
      ? { refuse: `${$.plugin.name} is already loaded from ${$.plugin.root}` }
      : next(e),
  ).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'mission', description: 'Open Mission control: every agent live, the context and the budget' })
    // Every load starts with the band in view: once hidden it has no way back
    // of its own (the switch is in the pane), so a hide never outlives the
    // load it was made in, an older version's Hide button's included.
    await update($, isBandHidden, () => false)
    await ensureMain($)
    await refresh($, true)
    await reconcile($)
    $.clock.every(BEAT_MS, () => {
      void heartbeat($)
    })
    return started
  })

  on('turn.start', async ($, e, next) => {
    await turnStarted($, e.text)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await turnEnded($, e)
    return done
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if ('agentId' in spawned && typeof spawned.agentId === 'string') await joined($, e, spawned.agentId, spawned.model)
    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      if (e.agentId !== undefined && result.usage !== null) lastSize.set(e.agentId, sizeOf(result.usage))
    } catch {
      // A count missed is a count estimated at the run's end.
    }
    return result
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    try {
      if (e.agentId === undefined && e.trigger !== 'precompute' && done.skip === undefined) {
        await update($, turns, () => [])
        void refresh($, true)
      }
    } catch {
      // As above.
    }
    return done
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const who = e.agentId ?? MAIN
    const tool = String(e.tool)
    if (INTERNAL.has(tool)) return next(e)
    await toolStarted($, who, tool, detailOf(tool, e as unknown as Readonly<Record<string, unknown>>))
    try {
      return await next(e)
    } finally {
      await toolEnded($, who)
    }
  }).catch(($, e, next) => next(e))

  on('ui.message', async ($, e, next) => {
    const data = e.data
    if (typeof data === 'object' && data !== null) {
      const message = data as Record<string, unknown>
      if (typeof message.select === 'string') await pick($, message.select)
      if (typeof message.focus === 'string') await update($, selected, () => (message.focus === MAIN ? null : (message.focus as string)))
      if (message.open === true) await openPane($)
    }
    return next(e)
  })

  on('command.run', { command: 'mission' }, async $ => {
    const isPlaced = await openPane($)
    return { text: isPlaced ? 'Mission control is open.' : 'Mission control is ready; widen the window to see it.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Each reading redraws the band: the context under the crew stays current,
    // a long wait turns into a nap and a hover's figures stay fresh.
    const [isHidden, members, current, history, now] = await Promise.all([read($, isBandHidden), read($, crew), read($, reading), read($, turns), $.clock.now()])
    if (isHidden) return next(e)

    const table = $.ui.resolve(e)
    const kit: Kit = { surface: e.surface, Box: table.Box, Text: table.Text, Button: table.Button }
    const Client = 'Client' in table ? table.Client : undefined
    const where: Where | null = e.surface === 'desktop' || e.surface === 'terminal' ? e.surface : null
    const { Box } = kit
    const shown = contextOf(fillOf(current, history), current)

    return Band(
      kit,
      {
        strip:
          Client === undefined || where === null ? null : (
            <Box flexGrow={1} flexShrink={1} minWidth={where === 'desktop' ? STRIP_MAIN_CH : 11}>
              <Client key="strip" module="./clawd.tsx" width="100%" height={where === 'desktop' ? STRIP_LH : 3} props={stripOf(members, now, where)} />
            </Box>
          ),
        context: shown.used === null ? null : shown,
        width: e.props.bodyColumns,
      },
      { open: () => void openPane($) },
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [members, pinned, current, history, taken, isHidden, now] = await Promise.all([
      read($, crew),
      read($, selected),
      read($, reading),
      read($, turns),
      read($, samples),
      read($, isBandHidden),
      $.clock.now(),
    ])
    const table = $.ui.resolve(e)
    const kit: Kit = { surface: e.surface, Box: table.Box, Text: table.Text, Button: table.Button }
    const Client = 'Client' in table ? table.Client : undefined
    const where: Where | null = e.surface === 'desktop' || e.surface === 'terminal' ? e.surface : null
    const width = Math.max(30, e.props.bodyColumns)
    const fill = fillOf(current, history)
    const focus = focusOf(members, pinned)
    const isBig = where === 'desktop' || width >= 44

    const stageProps: StageProps | null =
      where === null
        ? null
        : {
            view: 'stage',
            surface: where,
            big: isBig,
            actors: lineUp(members, now, true).map(one => actorOf(one, now)),
            selected: focus.member?.id ?? null,
            hint: hintOf(members),
          }

    const crewRows: CrewRow[] = lineUp(members, now, false)
      .slice(0, 10)
      .map(one => ({
        id: one.id,
        name: one.id === MAIN ? 'Claude' : labelOf(one),
        color: one.color,
        caption: captionFor(one, now),
        elapsed: span((one.endedAt ?? now) - one.startedAt),
        isEnded: ENDED.includes(one.mood),
        isPicked: one.id === focus.member?.id,
      }))

    return Pane(
      kit,
      {
        headline: headlineOf(members, now),
        stage:
          Client === undefined || stageProps === null ? null : (
            <Client key="stage" module="./clawd.tsx" width="100%" height={where === 'desktop' ? 7.5 : isBig ? 10 : 7} props={stageProps} />
          ),
        spotlight: focus.member === null ? null : spotlightOf(focus.member, now, focus.isPinned),
        crew: crewRows,
        context: contextOf(fill, current),
        spend: spendLine(current, taken, now),
        paces: (current?.limits ?? []).map(one => paceOf(one, taken, now)),
        isBandHidden: isHidden,
        width,
      },
      {
        close: () => void $.ui.close({ id: PANE }),
        pick: id => void pick($, id),
        follow: () => void update($, selected, () => null),
        toggleBand: () => void update($, isBandHidden, value => !value),
      },
    )
  })
}
