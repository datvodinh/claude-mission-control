// What Mission control keeps for the session, and what its surface module
// (hooks/clawd.tsx) is handed to draw.

/** What an agent is doing, as its Clawd shows it. */
export type Mood =
  | 'thinking' // the model is writing
  | 'working' // a tool runs
  | 'asking' // waiting on the person: a question, a plan to approve
  | 'delegating' // waiting on subagents it started
  | 'idle' // its turn ended
  | 'sleeping' // idle for a good while
  | 'done' // a subagent that finished
  | 'failed' // a subagent that ended in an error
  | 'stopped' // a subagent that was stopped

export type Step = { tool: string; detail: string | null; at: number }

export type Member = {
  /** `main` for Claude itself, else the subagent's id. */
  id: string
  /** `Claude`, or the subagent type (`Explore`, `general-purpose`). */
  type: string
  /** What it was asked: the prompt, or the task's few words. */
  task: string
  /** A theme key: `clawd_body` for Claude, a subagent colour for the rest. */
  color: string
  mood: Mood
  /** When the mood began. */
  since: number
  tool: string | null
  detail: string | null
  /** Tool calls so far (Claude's: this turn). */
  calls: number
  /** Tokens its run took, once it ended. */
  tokens: number | null
  model: string | null
  /** When it joined the session: Claude's when the session began. */
  joinedAt: number
  /** When its run (Claude's: this turn) began. */
  startedAt: number
  endedAt: number | null
  isBackground: boolean
  /** A teammate goes idle between turns rather than finishing. */
  isTeammate: boolean
  /** The latest tool calls, newest last. */
  recent: Step[]
}


export type Category = { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' }

export type Limit = { kind: string; percent: number; resetsAt: string | null }

export type Reading = {
  at: number
  model: string
  startedAt: number
  /** The last response's context, or before one (a fresh or just compacted window) /context's estimate. */
  context: { tokens: number; window: number; percent: number } | null
  /** Tokens at which auto-compact runs; null when it is off or not known yet. */
  compactAt: number | null
  categories: Category[]
  limits: Limit[]
  costUsd: number | null
}

export type Sample = { at: number; costUsd: number | null; fiveHour: number | null }

// ── What the surface module draws: plain data ─────────────────────────────

export type Where = 'desktop' | 'terminal'

export type Actor = {
  id: string
  name: string
  caption: string
  color: string
  mood: Mood
  /** How long it had been in this mood when the hooks drew. */
  ageMs: number
  /** How long since it joined: one that just did rises into view. */
  joinedMs: number
  /** The tool running, for its speech bubble. */
  tool: string | null
  isMain: boolean
}

export type StageProps = {
  view: 'stage'
  surface: Where
  /** Claude drawn at twice the crew's size. */
  big: boolean
  actors: Actor[]
  selected: string | null
  /** What the stage says while Claude has it to itself. */
  hint: string | null
}

export type Walker = {
  id: string
  /** `Claude`, or the subagent's type: what a hover names it. */
  name: string
  /** What it was asked, and what it is doing now: what a hover says of it. */
  task: string
  doing: string
  color: string
  mood: Mood
  ageMs: number
  joinedMs: number
}

/** The band's crew: Claude, then the subagents at work (and those just ended, to play it out), side by side. */
export type StripProps = {
  view: 'strip'
  surface: Where
  walkers: Walker[]
}

export type ClawdProps = StageProps | StripProps

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      crew: Member[]
      selected: string | null
      reading: Reading | null
      /** Context tokens after each of Claude's turns, oldest first. */
      turns: number[]
      samples: Sample[]
      isBandHidden: boolean
    }
  }
}
