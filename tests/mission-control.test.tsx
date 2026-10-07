import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { AgentSpawnInput, AgentStatus, On, RenderElement, ToolCallInput } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const START = Date.parse('2026-10-07T10:00:00Z')
/** Panes opened so far, across tests. */
let opens = 0

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 96,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
}

const PANE_PROPS = {
  title: 'Mission control',
  isFocused: true,
  bodyColumns: 64,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

/** What the session reads as: a context with or without a response yet, and what it has cost. */
type Usage = { tokens: number | undefined; cost: number }
const BUSY: Usage = { tokens: 351_400, cost: 12.4 }

function world(on: On, agents: { id: string; status: AgentStatus }[] = [], usage: Usage = BUSY): MockClock {
  mock.store(on)
  const clock = mock.clock(on, { now: START })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => {
    opens += 1
    return { value: { isPlaced: true as const } }
  })
  on('agent.list', () => ({
    value: agents.map(one => ({ id: one.id, description: 'Find the auth handlers', type: 'Explore', status: one.status })),
  }))
  on('session.usage', () => ({
    value: {
      startedAt: START - 40 * 60_000,
      context: {
        tokens: usage.tokens,
        window: 500_000,
        percent: usage.tokens === undefined ? undefined : Math.round((usage.tokens / 500_000) * 100),
        breakdown: {
          categories: [
            { name: 'System prompt', tokens: 9_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
            { name: 'System tools', tokens: 22_000, color: 'inactive', isDeferred: false, kind: 'used' },
            { name: 'Messages', tokens: 318_000, color: 'permission', isDeferred: false, kind: 'used' },
            { name: 'Free space', tokens: 112_000, color: 'promptBorder', isDeferred: false, kind: 'free' },
            { name: 'Autocompact buffer', tokens: 39_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
          ],
          totalTokens: usage.tokens === undefined ? 18_200 : 349_000,
          maxTokens: 500_000,
          rawMaxTokens: 500_000,
          autocompactSource: 'model-default',
          percentage: 70,
          gridRows: [],
          model: 'claude-opus-5-5',
          memoryFiles: [],
          mcpTools: [],
          agents: [],
          autoCompactThreshold: 461_400,
          isAutoCompactEnabled: true,
          apiUsage: null,
        },
      },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-07T12:30:00Z' },
        { kind: 'seven_day', percentUsed: 11, resetsAt: '2026-10-12T09:00:00Z' },
      ],
      cost: { usd: usage.cost },
    },
  }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'agent-1' }))
  on('tool.call', () => ({ result: 'ok' }))
  // Each model request answers having stood on 23k tokens of context.
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { input_tokens: 10, output_tokens: 1_200, cache_read_input_tokens: 21_000, cache_creation_input_tokens: 800, model: e.model },
    }
  })
  return clock
}

/** The Agent tool's call, as the engine hands it to agent.spawn. */
function spawnOf(description: string): AgentSpawnInput {
  return {
    tool_use_id: `toolu_${description.length}`,
    prompt: description,
    description,
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  }
}

/** Every colour a tree paints a Box with: on the desktop, the pixels. */
function paintOf(node: RenderElement | string | null | undefined, into = new Set<string>()): Set<string> {
  if (node === null || node === undefined || typeof node === 'string') return into
  const props = (node as { props?: { backgroundColor?: unknown } }).props
  if (typeof props?.backgroundColor === 'string') into.add(props.backgroundColor)
  for (const child of (node as { children?: (RenderElement | string)[] }).children ?? []) paintOf(child, into)
  return into
}

const kidsOf = (node: RenderElement) => (node as { children?: RenderElement[] }).children ?? []

/** The band's canvas pixel on the desktop, in columns. */
const PIXEL = 0.15

/** One ink's pixels in a desktop sprite, row by row, as [from, to) canvas columns. */
function inkRows(sprite: RenderElement, ink: string): [number, number][][] {
  return kidsOf(sprite).map(row => {
    let x = 0
    const runs: [number, number][] = []
    for (const run of kidsOf(row)) {
      const props = (run as { props: { width: number; marginLeft?: number; backgroundColor?: string } }).props
      x += Math.round((props.marginLeft ?? 0) / PIXEL)
      const w = Math.round(props.width / PIXEL)
      if (props.backgroundColor === ink) runs.push([x, x + w])
      x += w
    }
    return runs
  })
}

/** Whether pixels match their mirror image: a Clawd facing you does, one side-on does not. */
function isMirrored(rows: [number, number][][]): boolean {
  const all = rows.flat()
  const edges = Math.min(...all.map(run => run[0])) + Math.max(...all.map(run => run[1]))
  const spans = (runs: [number, number][]) => runs.map(([from, to]) => `${from}-${to}`).sort().join()
  return rows.every(runs => spans(runs) === spans(runs.map(([from, to]) => [edges - to, edges - from])))
}

/** Every string a tree draws, joined: what a person would read. */
function textOf(node: RenderElement | string | null | undefined): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  const children = (node as { children?: (RenderElement | string)[] }).children ?? []
  const props = (node as { props?: { label?: unknown } }).props
  const label = typeof props?.label === 'string' ? props.label : ''
  return label + children.map(textOf).join('')
}

test('the band is the crew, the context and a way in: no spend, no filler', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'mission-control', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const drawn = textOf(await band.drawn())
    expect(drawn).toContain('Mission control')
    // The spend and the limits wait in the pane.
    for (const figure of ['$12.40', '5h', 'Hide', 'No reading yet']) expect(drawn).not.toContain(figure)
    await band.resize({ columns: 60, rows: surface === 'desktop' ? 2 : 1, in: 'strip' })
    await band.advance(1000)
    // Claude, in its own colour: a head of block glyphs in a terminal, pixels on the desktop.
    const strip = await band.drawn({ in: 'strip' })
    if (surface === 'terminal') expect(textOf(strip)).toMatch(/▐.{5}▌/)
    else expect([...paintOf(strip)]).toContain('clawd_body')
    await band.unmount()
  }
})

function inkOf(node: RenderElement | string | null | undefined, into = new Set<string>()): Set<string> {
  if (node === null || node === undefined || typeof node === 'string') return into
  const props = (node as { props?: { color?: unknown } }).props
  if (typeof props?.color === 'string') into.add(props.color)
  for (const child of (node as { children?: (RenderElement | string)[] }).children ?? []) inkOf(child, into)
  return into
}

test('under the Clawds, the context as the pane shows it: how much, when it compacts, what fills it', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'mission-control', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const drawn = await band.drawn()
    const text = textOf(drawn)
    for (const figure of ['of 500k used', 'compact', 'Messages', 'Free space', '%']) expect(text).toContain(figure)
    expect(text).not.toContain('Autocompact buffer')
    if (surface === 'terminal') expect(text).not.toContain('▒')
    const colours = surface === 'terminal' ? inkOf(drawn) : paintOf(drawn)
    for (const part of ['permission', 'inactive', 'promptBorder']) expect([...colours]).toContain(part)
    await band.unmount()
  }
})

test('a fresh session: Claude alone, rising into view, and nothing else', async ($, on) => {
  world(on, [], { tokens: undefined, cost: 0 })
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'mission-control', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(textOf(await band.drawn()).replace(/[━─]/g, '')).toMatch(/^Mission control\d+k of 500k used · auto-compact at /)
    await band.unmount()
  }
})

test('a band hidden from the pane is back at the next load', async ($, on) => {
  world(on)
  // The engine's own band, while Mission control's is hidden: nothing.
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'mission-control', surface, component: 'Pane', requestId: 'mission-control', props: PANE_PROPS })
    await pane.press({ key: 'band' })
    await pane.unmount()
    const band = await $.ui.mount({ plugin: 'mission-control', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(textOf(await band.drawn())).not.toContain('Mission control')
    // A reload, like a resumed session, starts the session over.
    await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
    expect(textOf(await band.drawn()).replace(/[━─]/g, '')).toMatch(/^Mission control\d+k of 500k used · auto-compact at /)
    await band.unmount()
  }
})

test('hovering a Clawd on the band names it and says what it is doing', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(spawnOf('Map the billing module'))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/src/billing.ts', agentId: 'agent-1' } as unknown as ToolCallInput)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'mission-control', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await band.resize({ columns: 70, rows: surface === 'desktop' ? 2 : 1, in: 'strip' })
    await band.advance(125)
    expect(textOf(await band.drawn({ in: 'strip' }))).not.toContain('Explore')
    // The subagent's slot is the second, past Claude's.
    await band.pointer({ type: 'move', x: surface === 'desktop' ? 9 : 12, y: 0, in: 'strip' })
    const hovered = await band.drawn({ in: 'strip' })
    const said = textOf(hovered)
    expect(said).toContain('Explore')
    expect(said).toContain('thinking…')
    expect(said).toContain('Map the billing module')
    // A bubble of pixel paper on the desktop; plain words in a terminal, no paper to show seams.
    if (surface === 'desktop') expect([...paintOf(hovered)]).toContain('text')
    else expect([...paintOf(hovered)]).not.toContain('text'), expect(said).not.toMatch(/[▟▌]/)
    await band.pointer({ type: 'leave', x: 0, y: 0, in: 'strip' })
    const left = await band.drawn({ in: 'strip' })
    expect(textOf(left)).not.toContain('Explore')
    expect([...paintOf(left)]).not.toContain('text')
    // Over Claude, the subagent past it steps out of view behind the bubble.
    await band.advance(1000)
    expect(JSON.stringify(await band.drawn({ in: 'strip' }))).toContain('blue_FOR_SUBAGENTS_ONLY')
    await band.pointer({ type: 'move', x: 2, y: 0, in: 'strip' })
    const overClaude = await band.drawn({ in: 'strip' })
    expect(textOf(overClaude)).toContain('Claude')
    expect(JSON.stringify(overClaude)).not.toContain('blue_FOR_SUBAGENTS_ONLY')
    await band.unmount()
  }
})

test('a Clawd at work turns to look at you under the pointer, its laptop left on the desk', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(spawnOf('Map the billing module'))
  await $.tool.call({ tool: 'Read', file_path: '/work/app/src/billing.ts', agentId: 'agent-1' } as unknown as ToolCallInput)
  const BLUE = 'blue_FOR_SUBAGENTS_ONLY'

  const band = await $.ui.mount({ plugin: 'mission-control', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  await band.resize({ columns: 70, rows: 2, in: 'strip' })
  // It appears, walks to its desk and sits side-on at the laptop.
  await band.advance(125 * 12)
  const spriteOf = async () => kidsOf(kidsOf(await band.drawn({ in: 'strip' }))[1] as RenderElement)[0] as RenderElement
  const seated = await spriteOf()
  expect(isMirrored(inkRows(seated, BLUE))).toBe(false)
  await band.pointer({ type: 'move', x: 9, y: 0, in: 'strip' })
  // Hello: the far arm up...
  expect(isMirrored(inkRows(await spriteOf(), BLUE))).toBe(false)
  // ...then it faces you, the laptop where it was.
  await band.advance(125 * 10)
  const turned = await spriteOf()
  expect(isMirrored(inkRows(turned, BLUE))).toBe(true)
  expect(inkRows(turned, 'subtle')).toEqual(inkRows(seated, 'subtle'))
  await band.pointer({ type: 'leave', x: 0, y: 0, in: 'strip' })
  expect(isMirrored(inkRows(await spriteOf(), BLUE))).toBe(false)
  await band.unmount()

  // A terminal draws the whole Clawd in three rows: side-on at the laptop, then facing you.
  const rows = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  await rows.resize({ columns: 70, rows: 3, in: 'strip' })
  await rows.advance(125 * 12)
  const glyphsOf = async () => kidsOf(kidsOf(await rows.drawn({ in: 'strip' }))[1] as RenderElement)[0] as RenderElement
  const atDesk = await glyphsOf()
  expect(kidsOf(atDesk)).toHaveLength(3)
  expect(textOf(atDesk)).not.toMatch(/▐▛███▜▌/)
  expect([...inkOf(atDesk)]).toContain('inactive')
  await rows.pointer({ type: 'move', x: 14, y: 1, in: 'strip' })
  await rows.advance(125 * 10)
  const facing = await glyphsOf()
  expect(textOf(facing)).toMatch(/▐▛███▜▌|▐█████▌/)
  expect([...inkOf(facing)]).toContain('inactive')
  await rows.unmount()
})

test('idle and alone, Claude wanders the band and plays; back to work, it walks home to its desk', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'mission-control', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await band.resize({ columns: 120, rows: surface === 'desktop' ? 2 : 1, in: 'strip' })
    const placeOf = async () => {
      const slot = kidsOf(await band.drawn({ in: 'strip' }))[0] as { props?: { marginLeft?: number } } | undefined
      return slot?.props?.marginLeft ?? 0
    }
    const places = new Set<number>()
    const frames = new Set<string>()
    for (let i = 0; i < 400; i++) {
      await band.advance(125)
      places.add(await placeOf())
      frames.add(JSON.stringify(await band.drawn({ in: 'strip' })))
    }
    // It went places, and did more than walk there.
    expect(places.size).toBeGreaterThan(3)
    expect(frames.size).toBeGreaterThan(places.size)
    // Never into the room a hover's bubble needs.
    expect(Math.max(...places)).toBeLessThan(120 - 30)

    // Work: it heads home, and sits down at its laptop there.
    await $.turn.start({ text: 'Run the tests', turnId: `w-${surface}` })
    await band.advance(125 * 400)
    expect(await placeOf()).toBe(0)
    if (surface === 'desktop') expect([...paintOf(await band.drawn({ in: 'strip' }))]).toContain('subtle')
    await $.turn.complete({ answer: 'Done.', durationMs: 1_000, isAborted: false, turnId: `w-${surface}`, reason: 'answer' })
    await band.unmount()
  }
})

test("Claude's bubble says what it is doing, never a task's notice", async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Tidy the README', turnId: 't1' })
  await $.turn.complete({ answer: 'Done.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.start({ text: '<task-notification>\n<task-id>b1</task-id>\n</task-notification>', turnId: 't2' })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'mission-control', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await band.resize({ columns: 70, rows: surface === 'desktop' ? 2 : 1, in: 'strip' })
    await band.advance(125)
    await band.pointer({ type: 'move', x: 2, y: 0, in: 'strip' })
    const said = textOf(await band.drawn({ in: 'strip' }))
    expect(said).toContain('Claude')
    expect(said).toContain('thinking…')
    // Your own prompt stays out of Claude's bubble, and a notice is no prompt.
    expect(said).not.toContain('Tidy the README')
    expect(said).not.toContain('task-notification')
    await band.unmount()
  }
  const pane = await $.ui.mount({ plugin: 'mission-control', surface: 'desktop', component: 'Pane', requestId: 'mission-control', props: PANE_PROPS })
  expect(textOf(await pane.drawn())).not.toContain('task-notification')
})

test('a subagent sits at its laptop on the strip, cheers when done, and sinks out of sight', async ($, on) => {
  world(on, [{ id: 'agent-1', status: 'running' }])
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(spawnOf('Map the billing module'))
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'mission-control', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await band.resize({ columns: 60, rows: surface === 'desktop' ? 2 : 1, in: 'strip' })
    await band.advance(125 * 8)
    const before = await band.drawn({ in: 'strip' })
    if (surface === 'desktop') expect([...paintOf(before)]).toContain('blue_FOR_SUBAGENTS_ONLY')
    else expect(JSON.stringify(before)).toContain('blue_FOR_SUBAGENTS_ONLY')
    await band.unmount()
  }

  await $.turn.complete({ answer: 'Mapped.', durationMs: 30_000, isAborted: false, turnId: 'sub-1', agentId: 'agent-1', reason: 'answer' })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'mission-control', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await band.resize({ columns: 60, rows: surface === 'desktop' ? 2 : 1, in: 'strip' })
    await band.advance(125 * 4)
    // Still there, cheering...
    expect(JSON.stringify(await band.drawn({ in: 'strip' }))).toContain('blue_FOR_SUBAGENTS_ONLY')
    // ...then gone, Claude alone again.
    await band.advance(125 * 24)
    const after = JSON.stringify(await band.drawn({ in: 'strip' }))
    expect(after).not.toContain('blue_FOR_SUBAGENTS_ONLY')
    expect(after).toContain('clawd_body')
    await band.unmount()
  }
})

test('clicking a Clawd on the band opens Mission control on it', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(spawnOf('Map the billing module'))
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'mission-control', surface, component: 'AbovePrompt', props: BAND_PROPS })
    await band.resize({ columns: 60, rows: surface === 'desktop' ? 2 : 1, in: 'strip' })
    await band.advance(125)
    const before = opens
    // The subagent's slot is the second, past Claude's: the pane opens pinned on it.
    await band.pointer({ type: 'down', x: surface === 'desktop' ? 9 : 12, y: 0, button: 'left', in: 'strip' })
    expect(opens).toBe(before + 1)
    const pane = await $.ui.mount({ plugin: 'mission-control', surface, component: 'Pane', requestId: 'mission-control', props: PANE_PROPS })
    const pinned = textOf(await pane.drawn())
    expect(pinned).toContain('Map the billing module')
    expect(pinned).toContain('Follow the action')
    // Claude's is the whole crew's: the pane follows the action, nothing pinned.
    await band.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'strip' })
    expect(opens).toBe(before + 2)
    expect(textOf(await pane.drawn())).not.toContain('Follow the action')
    await pane.unmount()
    await band.unmount()
  }
})

test('the pane keeps no activity feed', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Tidy the README', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/README.md' })
  await $.turn.complete({ answer: 'Done.', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' })
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'mission-control', surface, component: 'Pane', requestId: 'mission-control', props: PANE_PROPS })
    const drawn = textOf(await pane.drawn())
    expect(drawn).not.toContain('Activity')
    expect(drawn).not.toContain('Turn done')
    await pane.unmount()
  }
})

test('a subagent joins the stage, works, and finishes with its tokens counted', async ($, on) => {
  world(on, [{ id: 'agent-1', status: 'running' }])
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Find where auth tokens are refreshed', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/work/app/src/auth.ts' })
  const spawned = await $.agent.spawn(spawnOf('Find the auth handlers'))
  expect('agentId' in spawned ? spawned.agentId : null).toBe('agent-1')

  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'mission-control', surface, component: 'Pane', requestId: 'mission-control', props: PANE_PROPS })
    const drawn = textOf(await pane.drawn())
    expect(drawn).toContain('Find the auth handlers')
    expect(drawn).toContain('Claude')
    expect(drawn).toContain('Explore')
    await pane.resize({ columns: 64, rows: 10, in: 'stage' })
    await pane.advance(2000)
    const stage = textOf(await pane.drawn({ in: 'stage' }))
    expect(stage).toContain('Explore')
    expect(stage).toContain('Claude')
    await pane.unmount()
  }

  // The engine's own handback is not work to show.
  await $.tool.call({ tool: 'SubagentHandback', agentId: 'agent-1' } as unknown as ToolCallInput)
  const step = $.turn.step({ turnId: 'sub-1', index: 3, model: 'claude-haiku-4-5', messageCount: 7, agentId: 'agent-1' })
  for await (const chunk of step) void chunk
  await step.result
  await $.turn.complete({
    answer: 'Found them.',
    durationMs: 41_000,
    isAborted: false,
    turnId: 'sub-1',
    agentId: 'agent-1',
    reason: 'answer',
    usage: { input_tokens: 2_000, output_tokens: 3_000, cache_read_input_tokens: 18_000, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' },
  })
  const pane = await $.ui.mount({ plugin: 'mission-control', surface: 'desktop', component: 'Pane', requestId: 'mission-control', props: PANE_PROPS })
  expect(textOf(await pane.drawn())).not.toContain('SubagentHandback')
  // Picked, its card: the size of the context its last response stood on, as Claude Code counts it.
  await pane.press({ key: 'pick:agent-1' })
  expect(textOf(await pane.drawn())).toContain('23k tokens')
  await pane.unmount()
})

test('clicking a Clawd puts it in the spotlight; clicking again follows the action', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(spawnOf('Map the billing module'))
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'mission-control', surface, component: 'Pane', requestId: 'mission-control', props: PANE_PROPS })
    await pane.resize({ columns: 64, rows: 10, in: 'stage' })
    // The newest subagent at work holds the spotlight until someone picks.
    expect(textOf(await pane.drawn())).toContain('Map the billing module')
    // Claude's slot is the first one: a click there pins Claude.
    await pane.pointer({ type: 'down', x: 2, y: 3, button: 'left', in: 'stage' })
    expect(textOf(await pane.drawn())).toContain('Follow the action')
    await pane.press({ key: 'follow' })
    expect(textOf(await pane.drawn())).not.toContain('Follow the action')
    await pane.unmount()
  }
})

test('a subagent at work sits side-on at its laptop, typing', async ($, on) => {
  world(on, [{ id: 'agent-1', status: 'running' }])
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.agent.spawn(spawnOf('Map the billing module'))
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'mission-control', surface, component: 'Pane', requestId: 'mission-control', props: PANE_PROPS })
    await pane.resize({ columns: 64, rows: 10, in: 'stage' })
    // It appears facing you, then walks over to its desk.
    await pane.advance(125 * 12)
    const frames = new Set<string>()
    for (let i = 0; i < 12; i++) {
      await pane.advance(125)
      frames.add(JSON.stringify(await pane.drawn({ in: 'stage' })))
    }
    expect(frames.size).toBeGreaterThan(2)
    const stage = await pane.drawn({ in: 'stage' })
    // The laptop's lid: a diagonal of block glyphs in a terminal, a grey back on the desktop.
    if (surface === 'terminal') expect(textOf(stage)).toContain('▚')
    else expect([...paintOf(stage)]).toContain('subtle')
    await pane.unmount()
  }
})

test('Claude naps once it has waited a while: eyes closed, breathing, snoring', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Say hello', turnId: 't1' })
  await $.turn.complete({ answer: 'Hello.', durationMs: 2_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(4 * 60_000)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'mission-control', surface, component: 'Pane', requestId: 'mission-control', props: PANE_PROPS })
    expect(textOf(await pane.drawn())).toContain('Napping')
    await pane.resize({ columns: 64, rows: 10, in: 'stage' })
    const frames = new Set<string>()
    let said = ''
    for (let i = 0; i < 24; i++) {
      await pane.advance(125)
      const stage = await pane.drawn({ in: 'stage' })
      frames.add(JSON.stringify(stage))
      said += textOf(stage)
    }
    expect(frames.size).toBeGreaterThan(1)
    expect(said).toContain('z z Z')
    // Closed eyes: in a terminal, a lid over each, `▛▀▜`.
    if (surface === 'terminal') expect(said).toContain('▛▀▜')
    await pane.unmount()
  }
})

test('the stage animates on its own clock while Claude thinks', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'Run the tests', turnId: 't1' })
  const pane = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', component: 'Pane', requestId: 'mission-control', props: PANE_PROPS })
  await pane.resize({ columns: 64, rows: 10, in: 'stage' })
  const frames = new Set<string>()
  for (let i = 0; i < 12; i++) {
    await pane.advance(125)
    frames.add(JSON.stringify(await pane.drawn({ in: 'stage' })))
  }
  // Thinking: the spinner over Claude's head turns every frame.
  expect(frames.size).toBeGreaterThan(5)
  await pane.unmount()
})
