// The crew, drawn where it is seen: pixel Clawds on the desktop, block
// characters in a terminal. The hooks hand it who is doing what; it keeps
// the frames, so the Clawds go on moving between the hooks' redraws.
//
// Two views share the sprites: `stage` (the pane's: everyone side by side,
// Claude twice the size, a speech bubble over each head) and `strip` (the
// band's: Claude and the crew at work, small, in a row). An agent at work
// sits side-on at a laptop, typing; one that waits on you, or is done, turns
// to face you, and so does one under the pointer, its laptop left on the desk.
//
// A frame is drawn only when something in it changed: a calm scene costs a
// blink every few seconds, a busy one eight frames a second.

import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'

import type { Actor, ClawdProps, Mood, StageProps, StripProps, Walker } from '../types'

const TICK_MS = 125

type State = { frame: number; hover: string | null }
type Surface = ClientSurface<State>
type Elements = Surface['elements']

// ── Pixels ────────────────────────────────────────────────────────────────
//
// A pixel is half a terminal cell wide and half a cell tall, as in the CLI
// logo, so it stands twice as tall as it is wide. The desktop draws one `w`
// ch wide and `tall(w)` lh tall: the same shape in its 13 px / 19 px line.

type Canvas = { width: number; height: number; ink: (string | null)[] }

const round3 = (n: number) => Math.round(n * 1000) / 1000
const tall = (w: number) => round3((w * 2 * 7.4) / 19)
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))

function blank(width: number, height: number): Canvas {
  return { width, height, ink: new Array<string | null>(width * height).fill(null) }
}

/**
 * Paints a block of a sprite's pixels: columns [col, col + w) of rows
 * [row, row + h), each pixel `scale` canvas pixels a side, the sprite's
 * corner at canvas (x, y). Halves land from scale 2 up and round down at
 * scale 1. `null` cuts a hole.
 */
function paint(c: Canvas, x: number, y: number, scale: number, col: number, row: number, w: number, h: number, ink: string | null): void {
  const x0 = Math.max(0, x + Math.floor(col * scale))
  const x1 = Math.min(c.width, x + Math.floor((col + w) * scale))
  const y0 = Math.max(0, y + Math.floor(row * scale))
  const y1 = Math.min(c.height, y + Math.floor((row + h) * scale))
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) c.ink[py * c.width + px] = ink
}

// ── The Clawd ─────────────────────────────────────────────────────────────
//
// 18 × 5 pixels, the CLI logo exactly:   ▐▛███▜▌
//                                        ▝▜█████▛▘
//                                          ▘▘ ▝▝
// The eyes are holes in the head; the arms move between rows; the legs
// scuttle between three stances. Side-on it faces left, toward its laptop:
// one eye, the brow's notch at the front of the face, the near arm reaching
// for the keys.

type View = 'front' | 'side'
type Eyes = 'open' | 'shut' | 'left' | 'right' | 'closed'
type Legs = 'stand' | 'out' | 'in' | 'none'

type Pose = {
  view: View
  eyes: Eyes
  legs: Legs
  /**
   * The row each arm is on: 2 at rest, 0 raised high, 1 waving, 3 lowered;
   * halves show from scale 2. Side-on, `armL` is the arm at the keys.
   */
  armL: number
  armR: number
  /** Rows above the stand (1, a hop) or below it (a half: settled down to doze). */
  lift: number
  /** Rows drawn from the feet up: 5 is all of it, fewer while it appears. */
  reveal: number
}

const LEGS: Record<Legs, readonly number[]> = {
  stand: [4, 6, 11, 13],
  out: [3, 5, 12, 14],
  in: [5, 7, 10, 12],
  none: [],
}
const SCUTTLE: readonly Legs[] = ['stand', 'out', 'stand', 'in']
const SPRITE_W = 18
const SPRITE_H = 5

/** An eye hole in the head's second row: its column, its width, and how far up from the row's foot it reaches. */
type Hole = readonly [number, number, number]

function holesOf(view: View, eyes: Eyes, isFine: boolean): readonly Hole[] {
  if (view === 'side') {
    const notch: Hole = [3, 1, 1]
    if (eyes === 'shut') return [notch]
    return [notch, eyes === 'closed' && isFine ? [7.5, 2, 0.5] : [8, 1, 1]]
  }
  switch (eyes) {
    case 'open':
      return [
        [5, 1, 1],
        [12, 1, 1],
      ]
    case 'left':
      return [
        [4, 1, 1],
        [11, 1, 1],
      ]
    case 'right':
      return [
        [6, 1, 1],
        [13, 1, 1],
      ]
    case 'shut':
      return []
    case 'closed':
      // Slits: half an eye tall where there is room for halves, else as wide
      // as two eyes, which a terminal draws as `▀`.
      return isFine
        ? [
            [4.5, 2, 0.5],
            [11.5, 2, 0.5],
          ]
        : [
            [4, 2, 1],
            [12, 2, 1],
          ]
  }
}

function drawClawd(c: Canvas, x: number, y: number, pose: Pose, ink: string, scale = 1): void {
  const hidden = SPRITE_H - pose.reveal
  const fill = (col: number, row: number, w: number, h: number, what: string | null = ink) => {
    if (row >= hidden) paint(c, x, y, scale, col, row, w, h, what)
  }
  for (let row = 0; row < 4; row++) fill(3, row, 12, 1)
  for (const [col, w, h] of holesOf(pose.view, pose.eyes, scale >= 2)) fill(col, 2 - h, w, h, null)
  if (pose.view === 'side') {
    fill(0, pose.armL, 3, 1)
  } else {
    fill(1, pose.armL, 2, 1)
    fill(15, pose.armR, 2, 1)
  }
  for (const col of LEGS[pose.legs]) fill(col, 4, 1, 1)
}

/** The laptop's greys: the lid's back and its screen, the keys. A terminal cell holds one colour, so it is one grey there. */
const DESK_INKS = {
  desktop: { back: 'subtle', face: 'inactive', keys: 'inactive' },
  terminal: { back: 'inactive', face: 'inactive', keys: 'inactive' },
}

/** How far left of a Clawd's own columns its laptop reaches. */
const LAPTOP_W = 6

/**
 * The laptop a Clawd types at, in the Clawd's own columns: to its left, the
 * lid leaning back from the hinge, the keyboard under its near arm. While it
 * works on the desktop, a line of the screen lights, scrolling down.
 */
function drawLaptop(c: Canvas, x: number, y: number, scale: number, glow: number | null, isDesktop: boolean): void {
  const inks = DESK_INKS[isDesktop ? 'desktop' : 'terminal']
  const fill = (col: number, row: number, w: number, h: number, ink: string) => paint(c, x, y, scale, col, row, w, h, ink)
  if (scale >= 2 && isDesktop) {
    // Half pixels: a two-tone lid, a slim keyboard.
    for (let i = 0; i < 5; i++) {
      fill(-5.5 + i / 2, 2 + i / 2, 0.5, 0.5, inks.back)
      fill(-5 + i / 2, 2 + i / 2, 0.5, 0.5, glow === i ? 'text' : inks.face)
    }
    fill(-3.5, 4.5, 5.5, 0.5, inks.keys)
    return
  }
  if (scale >= 2) {
    // A terminal's quadrants: the lid one line of `▚`, the keyboard `▙▄▄▄`.
    for (let i = 0; i < 5; i++) fill(-5 + i / 2, 2 + i / 2, 0.5, 0.5, inks.back)
    fill(-3, 4.5, 5, 0.5, inks.keys)
    return
  }
  for (let i = 0; i < 3; i++) fill(-5 + i, 1 + i, 1, 1, inks.back)
  fill(-3, 4, 5, 1, inks.keys)
}

/**
 * The row a Clawd's head starts on. The desktop keeps a row of headroom for
 * hops. A terminal draws two pixel rows per cell, so a head that starts on an
 * odd row comes out as a different set of block glyphs: at scale 1 it stands
 * on even rows (the CLI logo's own), and hops by tucking its legs instead.
 */
function standY(isDesktop: boolean, pose: Pose, scale: number): { y: number; pose: Pose } {
  if (isDesktop || scale > 1) return { y: Math.floor((1 - pose.lift) * scale), pose }
  if (pose.lift > 0) return { y: 0, pose: { ...pose, legs: 'none' } }
  return { y: 0, pose }
}

/** The row the floor puts a laptop's corner on: the Clawd's, standing. */
const floorY = (isDesktop: boolean, scale: number) => (isDesktop || scale > 1 ? scale : 0)

// ── Moods, as poses and speech bubbles ────────────────────────────────────

const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const SPARK = ['·', '✦', '✶', '✻', '✦', '·']
const ENDED: readonly Mood[] = ['done', 'failed', 'stopped']
/** Keys pressed, a frame each: steadily on a tool's work, in bursts while it writes. */
const TYPING: Record<'working' | 'thinking', string> = {
  working: '1101011010110101',
  thinking: '10101100000010110000',
}
/** A breath every three seconds while it dozes: in, then out with a snore. */
const BREATH = 24
const SNORE = ['z', 'z z', 'z z Z']
/** Frames a Clawd under the pointer waves hello before it just looks at you: two waves. */
const GREET = 8

/** When the module first saw an agent, or saw it in its mood; `isFresh` when that was live, not a late mount. */
type Mark = { mood: Mood; at: number; isFresh: boolean }

type Look = {
  pose: Pose
  ink: string
  bubble: string
  bubbleInk: string | null
  isPill: boolean
  /** At the laptop: which line of its screen is lit, if any. */
  desk: { glow: number | null } | null
}

type Who = { id: string; mood: Mood; color: string; tool: string | null }

function seedOf(text: string): number {
  let seed = 7
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) % 9973
  return seed
}

/** Where an idle Clawd looks: ahead, then left, ahead, right, a few seconds each. */
const glanceOf = (t: number): Eyes => (['open', 'left', 'open', 'right'] as const)[Math.floor(t / 22) % 4] ?? 'open'

/** `hovered`: frames since the pointer came to this Clawd, null while it is elsewhere. */
function lookOf(who: Who, frame: number, mark: Mark, born: Mark, hovered: number | null): Look {
  const t = frame + seedOf(who.id)
  const since = frame - mark.at
  const isBlink = t % 41 === 0
  const rest: Pose = { view: 'front', eyes: isBlink ? 'shut' : 'open', legs: 'stand', armL: 2, armR: 2, lift: 0, reveal: SPRITE_H }
  const droop: Pose = { ...rest, armL: 3, armR: 3 }
  let look: Look = { pose: rest, ink: who.color, bubble: ' ', bubbleInk: null, isPill: false, desk: null }

  switch (who.mood) {
    case 'working':
    case 'thinking': {
      const keys = TYPING[who.mood]
      const isDown = keys[t % keys.length] === '1'
      const isWorking = who.mood === 'working'
      look = {
        ...look,
        pose: { ...rest, view: 'side', armL: isDown ? 3.5 : 2.5 },
        desk: { glow: isWorking ? Math.floor(t / 2) % 7 : null },
        bubble: isWorking ? (who.tool ?? '…') : (SPIN[t % SPIN.length] ?? '·'),
        bubbleInk: isWorking ? null : who.color,
        isPill: isWorking && who.tool !== null,
      }
      break
    }
    case 'asking':
      look = { ...look, pose: { ...rest, armR: frame % 4 < 2 ? 0 : 1 }, bubble: '?', bubbleInk: 'warning' }
      break
    case 'delegating':
      look = { ...look, pose: { ...rest, eyes: isBlink ? 'shut' : 'right' }, bubble: '⋯', bubbleInk: 'subtle' }
      break
    case 'idle':
      look = { ...look, pose: { ...rest, eyes: isBlink ? 'shut' : glanceOf(t) } }
      break
    case 'sleeping':
      look = dozing(look, t)
      break
    case 'done': {
      const isCheering = mark.isFresh && since < 16
      look = {
        ...look,
        pose: isCheering ? { ...rest, eyes: 'closed', armL: 0, armR: 0, lift: since % 8 < 4 ? 1 : 0 } : rest,
        bubble: '✓',
        bubbleInk: 'success',
      }
      break
    }
    case 'failed':
      look = { ...look, pose: { ...droop, eyes: 'closed', legs: 'in' }, ink: 'inactive', bubble: '✕', bubbleInk: 'error' }
      break
    case 'stopped':
      look = { ...look, pose: droop, ink: 'inactive', bubble: '–', bubbleInk: 'subtle' }
      break
  }

  if (hovered !== null && !ENDED.includes(who.mood) && who.mood !== 'sleeping') {
    // It looks at you: at work it turns from its laptop, which stays on the
    // desk, still lit. It waves hello with the far arm, then holds your gaze.
    const isAtDesk = look.desk !== null
    look = {
      ...look,
      pose: {
        ...look.pose,
        view: 'front',
        eyes: isBlink ? 'shut' : 'open',
        armL: isAtDesk ? 2 : look.pose.armL,
        armR: hovered < GREET ? (hovered % 4 < 2 ? 0 : 1) : look.pose.armR,
      },
    }
  }
  const age = frame - born.at
  if (born.isFresh && age >= 0 && age < SPARK.length) {
    // Appearing: it rises from the floor facing you, then goes to its desk.
    look = {
      ...look,
      pose: { ...look.pose, view: 'front', armL: 2, armR: 2, reveal: Math.min(SPRITE_H, age + 1) },
      desk: null,
      bubble: SPARK[age] ?? '·',
      bubbleInk: who.color,
      isPill: false,
    }
  }
  return look
}

/**
 * Asleep: eyes closed, legs splayed. It rises as it breathes in, and settles,
 * arms dropping, as it breathes out with a snore.
 */
function dozing(look: Look, t: number): Look {
  const phase = t % BREATH
  const isOut = phase >= BREATH / 2
  const snore = Math.floor(((phase - BREATH / 2) / (BREATH / 2)) * SNORE.length)
  return {
    ...look,
    pose: { ...look.pose, view: 'front', eyes: 'closed', legs: 'out', armL: isOut ? 3 : 2.5, armR: isOut ? 3 : 2.5, lift: isOut ? -0.5 : 0 },
    bubble: isOut ? (SNORE[snore] ?? ' ') : ' ',
    bubbleInk: 'subtle',
  }
}

/** On its way somewhere: facing you, scuttling, looking where it goes. */
function walking(look: Look, heading: number, frame: number): Look {
  return {
    ...look,
    desk: null,
    pose: { ...look.pose, view: 'front', legs: SCUTTLE[frame % 4] ?? 'stand', eyes: heading > 0 ? 'right' : 'left', armL: 2, armR: 2, lift: 0 },
  }
}

const keyOf = (look: Look) => {
  const p = look.pose
  const desk = look.desk === null ? '-' : String(look.desk.glow)
  return `${p.view}.${p.eyes}.${p.legs}.${p.armL}.${p.armR}.${p.lift}.${p.reveal}.${look.ink}.${look.bubble}.${desk}`
}

// ── What each instance remembers between frames ───────────────────────────

type Memo = {
  /** The frame clock: one tick every TICK_MS, drawn or not. */
  ticks: number
  props: ClawdProps | null
  moods: Map<string, Mark>
  born: Map<string, Mark>
  /** Who is drawn, in order, each slot's columns for the pointer, and where in its slot each Clawd stands. */
  cast: string[]
  slots: { id: string; from: number; to: number }[]
  at: Map<string, number>
  /** The tick the pointer came to the Clawd it is on: its hello starts there. */
  hoverAt: number
  /** Claude idling alone on the band: where it is, and what it is up to. */
  roam: Roam | null
  /** What the frame on screen shows, so a still frame is not drawn again. */
  shown: string
}

const memos = new WeakMap<object, Memo>()

function memoOf(surface: Surface): Memo {
  let memo = memos.get(surface)
  if (memo === undefined) {
    memo = {
      ticks: 0,
      props: null,
      moods: new Map(),
      born: new Map(),
      cast: [],
      slots: [],
      at: new Map(),
      hoverAt: 0,
      roam: null,
      shown: '',
    }
    memos.set(surface, memo)
  }
  return memo
}

/** Notes each agent's arrival and each change of mood, as the props bring them. */
function remember(memo: Memo, who: readonly { id: string; mood: Mood; ageMs: number; joinedMs: number }[]): void {
  for (const one of who) {
    const isFresh = one.ageMs < 2500
    if (!memo.born.has(one.id)) {
      memo.born.set(one.id, { mood: one.mood, at: memo.ticks, isFresh: one.joinedMs < 2500 && !ENDED.includes(one.mood) })
    }
    if (memo.moods.get(one.id)?.mood !== one.mood) memo.moods.set(one.id, { mood: one.mood, at: memo.ticks, isFresh })
  }
}

const LONG_AGO: Mark = { mood: 'idle', at: -1000, isFresh: false }

function looksOf(memo: Memo, who: readonly Who[], frame: number, hover: string | null): Look[] {
  return who.map(one => {
    const look = lookOf(one, frame, memo.moods.get(one.id) ?? LONG_AGO, memo.born.get(one.id) ?? LONG_AGO, hover === one.id ? frame - memo.hoverAt : null)
    return memo.roam?.id === one.id && hover !== one.id ? roamLook(look, memo.roam, frame, one.mood) : look
  })
}

// ── Drawing pixels on each surface ────────────────────────────────────────

/**
 * Desktop: one row of pixels as Boxes, a Box per run of one colour. Each run
 * reaches a hair into the row below, which paints over it: rows a fraction
 * of a line tall would otherwise show hairline seams where they meet.
 */
function pixelRow(el: Elements, inks: readonly (string | null)[], w: number, rowLh: number): RenderElement {
  const { Box } = el
  const reach = round3(rowLh + Math.min(0.06, rowLh * 0.2))
  const runs: RenderElement[] = []
  let gap = 0
  let x = 0
  while (x < inks.length) {
    const ink = inks[x] ?? null
    if (ink === null) {
      gap += 1
      x += 1
      continue
    }
    let n = 1
    while (x + n < inks.length && inks[x + n] === ink) n += 1
    runs.push(
      <Box
        width={round3(n * w)}
        height={reach}
        flexShrink={0}
        backgroundColor={ink}
        {...(gap > 0 ? { marginLeft: round3(gap * w) } : {})}
      />,
    )
    gap = 0
    x += n
  }
  return (
    <Box flexDirection="row" height={rowLh} flexShrink={0}>
      {runs}
    </Box>
  )
}

/** The canvas as rows of Boxes, rows alike drawn as one. */
function pixelRows(el: Elements, c: Canvas, w: number): RenderElement[] {
  const rows: RenderElement[] = []
  const rowOf = (y: number) => c.ink.slice(y * c.width, (y + 1) * c.width)
  const isSame = (a: number, b: number) => {
    for (let x = 0; x < c.width; x++) if (c.ink[a * c.width + x] !== c.ink[b * c.width + x]) return false
    return true
  }
  let y = 0
  while (y < c.height) {
    let n = 1
    while (y + n < c.height && isSame(y, y + n)) n += 1
    rows.push(pixelRow(el, rowOf(y), w, round3(tall(w) * n)))
    y += n
  }
  return rows
}

const QUADS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'
const CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 0, 1],
  [1, 0, 2],
  [0, 1, 4],
  [1, 1, 8],
]

type Run = { ink: string | null; text: string }

/** Terminal: a cell holds 2 × 2 pixels as one quadrant block, in one colour. */
function quadCells(c: Canvas, cy: number): Run[] {
  const cells: Run[] = []
  for (let cx = 0; cx < Math.ceil(c.width / 2); cx++) {
    let bits = 0
    let ink: string | null = null
    for (const [dx, dy, bit] of CORNERS) {
      const x = cx * 2 + dx
      const y = cy * 2 + dy
      if (x >= c.width || y >= c.height) continue
      const here = c.ink[y * c.width + x] ?? null
      if (here !== null && (ink === null || here === ink)) {
        bits |= bit
        ink = here
      }
    }
    cells.push({ ink, text: QUADS[bits] ?? ' ' })
  }
  return cells
}

/** Joins cells into runs of one colour; a blank joins whatever is beside it. */
function joinRuns(cells: readonly Run[]): Run[] {
  const runs: Run[] = []
  for (const cell of cells) {
    const last = runs[runs.length - 1]
    if (last !== undefined && (cell.ink === null || last.ink === null || last.ink === cell.ink)) {
      last.text += cell.text
      if (last.ink === null) last.ink = cell.ink
    } else {
      runs.push({ ...cell })
    }
  }
  return runs
}

function textRow(el: Elements, runs: readonly Run[]): RenderElement {
  const { Text } = el
  return (
    <Text wrap="truncate">
      {runs.map(run => (run.ink === null ? run.text : <Text color={run.ink}>{run.text}</Text>))}
    </Text>
  )
}

function quadRows(el: Elements, c: Canvas): RenderElement[] {
  const rows: RenderElement[] = []
  for (let cy = 0; cy < Math.ceil(c.height / 2); cy++) rows.push(textRow(el, joinRuns(quadCells(c, cy))))
  return rows
}

// ── The stage ─────────────────────────────────────────────────────────────
//
// Each Clawd stands in a slot of its own, on a canvas wide enough for it and
// its laptop. Facing you it stands in the middle; at work it sits right of
// the middle, the laptop at its left, and it walks between the two. Turned
// from its laptop to look at you, it keeps its seat, a step to the left.

const STAGE = {
  desktop: { mainPixel: 0.4, crewPixel: 0.2, mainSlot: 18, crewSlot: 11 },
  terminal: { mainPixel: 0.5, crewPixel: 0.5, mainSlot: 23, crewSlot: 12 },
}

/** A slot's canvas, in sprite pixels, and where in it the Clawd's own columns start, each way it faces. */
const SCENE_W = 21
const FRONT_AT = 2
const SIDE_AT = 6

/** Who is on the stage: Claude, then as many of the crew as fit, then a count of the rest. */
function castOf(props: StageProps, columns: number): { cast: Actor[]; more: number; mainSlot: number } {
  const size = STAGE[props.surface]
  const mainSlot = props.surface === 'desktop' || props.big ? size.mainSlot : size.crewSlot
  const main = props.actors.find(one => one.isMain)
  const crew = props.actors.filter(one => !one.isMain)
  const fit = Math.max(0, Math.floor((columns - mainSlot) / size.crewSlot))
  const shown = crew.length > fit ? crew.slice(0, Math.max(0, fit - 1)) : crew
  return { cast: [...(main === undefined ? [] : [main]), ...shown], more: crew.length - shown.length, mainSlot }
}

/** Canvas pixels per sprite pixel: twice for Claude, and on the desktop for everyone, drawn finer. */
const scaleOf = (props: StageProps, actor: Actor) => (props.surface === 'desktop' || (actor.isMain && props.big) ? 2 : 1)

type Figure<T extends Who = Actor> = { actor: T; look: Look; at: number }

const homeOf = (look: Look) => (look.desk === null ? FRONT_AT : SIDE_AT)
/** How far left of its seat a Clawd turned from its laptop stands: facing you, its far arm needs the room. */
const TURN = 2

/** A Clawd on its slot's canvas: its laptop at the seat, then the Clawd, side-on at the keys or turned to you. */
function drawFigure(c: Canvas, look: Look, at: number, k: number, isDesktop: boolean, reveal = look.pose.reveal): void {
  if (look.desk !== null) drawLaptop(c, at * k, floorY(isDesktop, k), k, look.desk.glow, isDesktop)
  const x = look.desk !== null && look.pose.view === 'front' ? at - TURN : at
  const stand = standY(isDesktop, look.pose, k)
  drawClawd(c, x * k, stand.y, { ...stand.pose, reveal }, look.ink, k)
}

/** Each Clawd as it looks this frame, where it stands, walking if it is not home yet. */
function figuresOf<T extends Who>(memo: Memo, cast: readonly T[], frame: number, hover: string | null): Figure<T>[] {
  const looks = looksOf(memo, cast, frame, hover)
  const out: Figure<T>[] = []
  cast.forEach((actor, i) => {
    const look = looks[i]
    if (look === undefined) return
    const home = homeOf(look)
    const at = memo.at.get(actor.id) ?? home
    if (!memo.at.has(actor.id)) memo.at.set(actor.id, at)
    out.push({ actor, look: at === home ? look : walking(look, Math.sign(home - at), frame), at })
  })
  return out
}

/** One tick: each Clawd two pixels nearer where it belongs. */
function shuffle(memo: Memo, cast: readonly Who[], frame: number, hover: string | null): void {
  looksOf(memo, cast, frame, hover).forEach((look, i) => {
    const id = cast[i]?.id
    if (id === undefined) return
    const home = homeOf(look)
    const at = memo.at.get(id)
    memo.at.set(id, at === undefined ? home : at + clamp(home - at, -2, 2))
  })
}

const stageKey = (figures: readonly Figure<Who>[]) => figures.map(one => `${one.at}:${keyOf(one.look)}`).join('|')

function stage(props: StageProps, memo: Memo, frame: number, hover: string | null, surface: Surface): RenderElement {
  const el = surface.elements
  const { Box, Text } = el
  const isDesktop = props.surface === 'desktop'
  const size = STAGE[props.surface]
  const { cast, more, mainSlot } = castOf(props, surface.columns)
  const figures = figuresOf(memo, cast, frame, hover)
  const hasCrew = props.actors.some(one => !one.isMain)

  type Slot = { figure: Figure | null; width: number }
  const slots: Slot[] = figures.map(figure => ({ figure, width: figure.actor.isMain ? mainSlot : size.crewSlot }))
  if (more > 0) slots.push({ figure: null, width: size.crewSlot })

  let from = 0
  memo.slots = []
  for (const slot of slots) {
    if (slot.figure !== null) memo.slots.push({ id: slot.figure.actor.id, from, to: from + slot.width })
    from += slot.width
  }
  memo.cast = cast.map(one => one.id)
  memo.shown = stageKey(figures)

  const sprite = ({ actor, look, at }: Figure) => {
    const k = scaleOf(props, actor)
    const c = blank(SCENE_W * k, (SPRITE_H + 1) * k)
    drawFigure(c, look, at, k, isDesktop)
    if (!isDesktop) return <Box flexDirection="column">{quadRows(el, c)}</Box>
    const pixel = actor.isMain ? size.mainPixel : size.crewPixel
    return (
      <Box flexDirection="column" width={round3(c.width * pixel)} flexShrink={0}>
        {pixelRows(el, c, pixel)}
      </Box>
    )
  }

  const bubble = (look: Look | null) =>
    look === null ? (
      <Text> </Text>
    ) : look.isPill && isDesktop ? (
      <Box flexDirection="column" alignItems="center" width="100%">
        <Text wrap="truncate-end" color="text" backgroundColor="promptBorder">
          {` ${look.bubble} `}
        </Text>
        <Box width={0.8} height={0.22} backgroundColor="promptBorder" />
      </Box>
    ) : look.isPill ? (
      <Text wrap="truncate-end" color="text" backgroundColor="userMessageBackgroundHover">
        {` ${look.bubble} `}
      </Text>
    ) : (
      <Text wrap="truncate-end" bold color={look.bubbleInk ?? 'subtle'}>
        {look.bubble}
      </Text>
    )

  const actorOf = (slot: Slot) => slot.figure?.actor ?? null
  const floorInk = (slot: Slot) => {
    const actor = actorOf(slot)
    return actor !== null && actor.id === props.selected ? (slot.figure?.look.ink ?? 'promptBorder') : 'promptBorder'
  }
  const labelInk = (slot: Slot) => {
    const actor = actorOf(slot)
    return actor === null ? 'subtle' : ENDED.includes(actor.mood) ? 'inactive' : 'text'
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="row" alignItems="flex-end">
        {slots.map(slot => (
          <Box flexDirection="column" alignItems="center" width={slot.width} flexShrink={0}>
            {bubble(slot.figure?.look ?? null)}
            {slot.figure !== null ? sprite(slot.figure) : <Text bold color="subtle">{`+${more}`}</Text>}
          </Box>
        ))}
        {hasCrew ? null : (
          <Box flexDirection="column" flexGrow={1} paddingLeft={2}>
            <Text color="subtle" wrap="wrap">
              {props.hint ?? 'Subagents join the stage as Claude starts them.'}
            </Text>
          </Box>
        )}
      </Box>
      <Box flexDirection="row">
        {slots.map(slot =>
          isDesktop ? (
            <Box width={slot.width} height={0.16} flexShrink={0} backgroundColor={floorInk(slot)} />
          ) : (
            <Text color={floorInk(slot)}>{'▔'.repeat(slot.width)}</Text>
          ),
        )}
        {isDesktop ? <Box flexGrow={1} height={0.16} backgroundColor="promptBorder" /> : null}
      </Box>
      <Box flexDirection="row" marginTop={isDesktop ? 0.2 : 0}>
        {slots.map(slot => {
          const actor = actorOf(slot)
          return (
            <Box width={slot.width} flexShrink={0} justifyContent="center" paddingX={1}>
              <Text
                wrap="truncate-end"
                bold={actor !== null && (actor.isMain || actor.id === props.selected)}
                underline={actor !== null && actor.id === hover}
                color={labelInk(slot)}
              >
                {actor?.name ?? 'more'}
              </Text>
            </Box>
          )
        })}
      </Box>
      <Box flexDirection="row">
        {slots.map(slot => (
          <Box width={slot.width} flexShrink={0} justifyContent="center" paddingX={1}>
            <Text wrap="truncate-end" color="subtle">
              {actorOf(slot)?.caption ?? ' '}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** The stage's actors as cast at the last draw, in order. */
function castNow(memo: Memo, props: StageProps): Actor[] {
  return memo.cast.map(id => props.actors.find(one => one.id === id)).filter((one): one is Actor => one !== undefined)
}

// ── The strip ─────────────────────────────────────────────────────────────
//
// The band's: Claude, then the crew at work, each in a slot as wide as its
// scene, packed from the left. A subagent that ends plays it out (a cheer,
// or a droop) and sinks out of sight. A terminal gives it one row: the
// heads, their eyes at work. A nap snores beside the head. A hover names
// the Clawd under the pointer and says what it is doing; the Clawd turns to
// look at you and waves hello.

/** The desktop's: a canvas pixel in ch, drawn at twice the sprite's pixels for the fine details. */
const STRIP = { pixel: 0.15, scale: 2, gap: 1 }
/** Frames an ended subagent stays before it sinks: two hops' cheer. */
const STAY = 16

type OnStrip = { walker: Walker; who: Who; reveal: number; aside: string | null }

// ── Idling on the band ────────────────────────────────────────────────────
//
// Alone and waiting on you, Claude has the band to itself: it wanders off
// along it, looks about, hops, dances, stretches, twirls, ducks into the
// floor and pops back up, and dozes off for a while. Back to work, it walks
// home to its desk. Under the pointer it stops to look at you.

type Act = 'walk' | 'look' | 'hop' | 'dance' | 'stretch' | 'twirl' | 'peek' | 'doze'
/** Where it is and where it is headed, in the strip's cells; what it is doing since `at`, until `until`. */
type Roam = { id: string; x: number; to: number; act: Act; at: number; until: number }

/** Each act's odds, out of 100, and how many frames it lasts (a walk lasts until it gets there). */
const ACTS: readonly (readonly [Act, number, number])[] = [
  ['walk', 38, 0],
  ['look', 20, 32],
  ['hop', 8, 18],
  ['dance', 8, 32],
  ['stretch', 8, 24],
  ['twirl', 6, 16],
  ['peek', 4, 18],
  ['doze', 8, 96],
]
/** How far it walks a frame: a sprite pixel on the desktop, half a cell in a terminal. */
const STRIDE = { desktop: 0.3, terminal: 0.5 }
/** Cells kept clear right of where it may wander, so a hover's bubble always has room. */
const ROAM_CLEAR = 30

/** A number from 0 to n - 1 that a frame always gives the same, frames apart no alike. */
function roll(frame: number, n: number): number {
  let h = Math.imul(frame ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) % n
}

/** One frame of Claude's idling: a step nearer where it is going, or its next act. */
function roamTick(memo: Memo, main: Walker | undefined, isAlone: boolean, room: number, step: number, frame: number, isHovered: boolean): void {
  if (main === undefined) {
    memo.roam = null
    return
  }
  const r: Roam = memo.roam?.id === main.id ? memo.roam : { id: main.id, x: 0, to: 0, act: 'look', at: frame, until: frame + 24 }
  memo.roam = r
  const toward = (to: number) => (Math.abs(to - r.x) <= step ? to : round3(r.x + Math.sign(to - r.x) * step))
  if (!isAlone) {
    // Company: back in its own slot at once, so no one stands on another.
    Object.assign(r, { x: 0, to: 0, act: 'look', at: frame, until: frame + 24 })
    return
  }
  if (main.mood === 'sleeping') {
    // A nap stays where it falls.
    Object.assign(r, { to: r.x, act: 'look', at: frame, until: frame + 24 })
    return
  }
  if (main.mood !== 'idle') {
    // To work: home to the desk.
    Object.assign(r, { to: 0, act: 'walk', x: toward(0) })
    return
  }
  if (isHovered) {
    r.until += 1
    return
  }
  const far = Math.max(0, room)
  if (r.act === 'walk' && r.x !== r.to) {
    r.x = toward(Math.min(r.to, far))
    return
  }
  if (r.act !== 'walk' && frame < r.until) return
  // Next: a walk to somewhere else on the band, or an act where it stands.
  let pick = roll(frame, 100)
  const found = ACTS.find(([, odds]) => (pick -= odds) < 0) ?? ACTS[1]
  const [act, , lasts] = found ?? ['look', 0, 32]
  if (act === 'walk' && far >= 4) {
    let to = Math.round((roll(frame + 7, 1000) / 1000) * far / step) * step
    if (Math.abs(to - r.x) < 4) to = r.x < far / 2 ? far : 0
    Object.assign(r, { act, to: round3(to), at: frame, until: frame })
    return
  }
  Object.assign(r, { act: act === 'walk' ? 'look' : act, to: r.x, at: frame, until: frame + (lasts || 32) })
}

/** How Claude looks at its act this frame, over the look its mood gave it. */
function roamLook(look: Look, r: Roam, frame: number, mood: Mood): Look {
  if (r.act === 'walk' && r.x !== r.to) return walking(look, Math.sign(r.to - r.x), frame)
  if (mood !== 'idle') return look
  const t = frame - r.at
  const pose = look.pose
  switch (r.act) {
    case 'hop': {
      const isUp = t % 6 < 3
      return { ...look, pose: { ...pose, lift: isUp ? 1 : 0, armL: isUp ? 1 : 2, armR: isUp ? 1 : 2, eyes: 'open' } }
    }
    case 'dance': {
      const isLeft = t % 4 < 2
      return { ...look, pose: { ...pose, eyes: 'closed', legs: SCUTTLE[t % 4] ?? 'stand', armL: isLeft ? 0 : 2, armR: isLeft ? 2 : 0 } }
    }
    case 'stretch':
      // Arms up, eyes squeezed shut, a long breath; then a shake.
      return t < 14
        ? { ...look, pose: { ...pose, eyes: 'closed', armL: 0, armR: 0, lift: t < 4 ? 0 : 0.5 } }
        : { ...look, pose: { ...pose, armL: t % 2 === 0 ? 1 : 2, armR: t % 2 === 0 ? 2 : 1 } }
    case 'twirl':
      return t % 4 < 2 ? { ...look, pose: { ...pose, view: 'side', eyes: 'open' } } : { ...look, pose: { ...pose, eyes: t % 8 < 4 ? 'left' : 'right' } }
    case 'peek': {
      // Ducks into the floor and pops back up.
      const down = Math.max(0, Math.min(SPRITE_H - 1, Math.floor(Math.min(t, 18 - t) / 2)))
      return { ...look, pose: { ...pose, reveal: Math.min(pose.reveal, SPRITE_H - down), eyes: t < 9 ? 'open' : 'shut' } }
    }
    case 'doze':
      return dozing(look, t)
    default:
      return look
  }
}

/** What a Clawd says beside its head, for the moods that speak: a snore (room kept between snores), a question. */
function asideOf(look: Look, mood: Mood): string | null {
  if (mood === 'sleeping') return look.bubble === ' ' ? '' : look.bubble
  if (mood === 'asking') return '?'
  return null
}

/** Who is on the strip this frame, how much of each shows, and what each says: an ended one only while it plays out. */
function onStrip(memo: Memo, walkers: readonly Walker[], frame: number, hover: string | null): OnStrip[] {
  const out: OnStrip[] = []
  for (const walker of walkers) {
    const who: Who = { id: walker.id, mood: walker.mood, color: walker.color, tool: null }
    let reveal = SPRITE_H
    if (ENDED.includes(walker.mood)) {
      const mark = memo.moods.get(walker.id)
      if (mark === undefined || !mark.isFresh) continue
      reveal = Math.min(SPRITE_H, SPRITE_H - (frame - mark.at - STAY))
      if (reveal <= 0) continue
    }
    out.push({ walker, who, reveal, aside: null })
  }
  looksOf(memo, out.map(one => one.who), frame, hover).forEach((look, i) => {
    const one = out[i]
    if (one === undefined) return
    const isDozing = memo.roam?.id === one.walker.id && memo.roam.act === 'doze' && one.walker.mood === 'idle' && one.walker.id !== hover
    one.aside = asideOf(look, isDozing ? 'sleeping' : one.walker.mood)
  })
  return out
}

/** A frame of the strip as a key: who is on it, then each drawn Clawd's look and place. */
function stripKey(all: readonly OnStrip[], drawn: readonly OnStrip[], figures: readonly Figure<Who>[], x: number): string {
  const who = all.map(one => `${one.walker.id}^${one.reveal}`).join(',')
  const looks = drawn.map((one, i) => {
    const figure = figures[i]
    return figure === undefined ? '' : `${one.aside ?? '-'}@${figure.at}:${keyOf(figure.look)}`
  })
  return `${who}~${x}#${looks.join('|')}`
}

const ASIDE_W = 6
/** A terminal strip's slot: a scene's columns, two to a cell. */
const STRIP_CELLS = Math.ceil(SCENE_W / 2)
const MORE_W = 4
/** The slot of the `+N` the strip has no room for. */
const MORE = '+'

function strip(props: StripProps, memo: Memo, frame: number, hover: string | null, surface: Surface): RenderElement {
  const el = surface.elements
  const { Box, Text } = el
  const isDesktop = props.surface === 'desktop'
  const all = onStrip(memo, props.walkers, frame, hover)

  // As many as fit, Claude first, then a count of the rest.
  const gap = isDesktop ? STRIP.gap : 1
  const widthOf = (one: OnStrip, i: number) =>
    (isDesktop ? round3(SCENE_W * STRIP.pixel * STRIP.scale) : STRIP_CELLS) + (one.aside === null ? 0 : ASIDE_W)
  const room = all.map((one, i) => widthOf(one, i) + (i === 0 ? 0 : gap))
  const across = (n: number) => room.slice(0, n).reduce((sum, one) => sum + one, 0) + (n < all.length ? gap + MORE_W : 0)
  let fit = all.length
  while (fit > 1 && across(fit) > surface.columns) fit -= 1
  const drawn = all.slice(0, fit)
  const more = across(fit) <= surface.columns ? all.length - fit : 0

  // Claude, idling, stands where its wandering took it.
  const roamX = roamAt(memo, drawn[0]?.walker.id, isDesktop)
  memo.slots = []
  let from = roamX
  drawn.forEach((one, i) => {
    if (i > 0) from += gap
    const w = widthOf(one, i)
    memo.slots.push({ id: one.walker.id, from, to: from + w })
    from += w
  })
  if (more > 0) memo.slots.push({ id: MORE, from: from + gap, to: from + gap + MORE_W })
  memo.cast = drawn.map(one => one.walker.id)
  const figures = figuresOf(memo, drawn.map(one => one.who), frame, hover)
  memo.shown = stripKey(all, drawn, figures, roamX)

  const aside = (one: OnStrip) =>
    one.aside === null ? null : (
      <Box width={ASIDE_W} flexShrink={0} paddingLeft={1}>
        <Text bold color={one.walker.mood === 'asking' ? 'warning' : 'subtle'}>
          {one.aside}
        </Text>
      </Box>
    )
  const count =
    more === 0 ? null : (
      <Box flexShrink={0} marginLeft={gap} alignSelf="center">
        <Text bold underline={hover === MORE} color="subtle">{`+${more}`}</Text>
      </Box>
    )
  // The bubble floats over the strip from the hovered slot's right edge, so
  // showing it moves no Clawd. Those past it step out of view behind it, or
  // a neighbour's laptop would show through its stepped edges; the pointer
  // still finds them where they stand.
  const pointed = all.find(one => one.walker.id === hover)?.walker
  const hidden = all.slice(drawn.length).map(one => one.walker.name)
  const say: Say | null =
    pointed !== undefined
      ? { name: pointed.name, doing: pointed.doing, task: pointed.task }
      : hover === MORE && hidden.length > 0
        ? { name: `+${hidden.length}`, doing: hidden.join(', '), task: '' }
        : null
  const under = memo.slots.find(one => one.id === hover)
  const left = under === undefined ? 0 : Math.ceil(under.to) + (isDesktop ? 0 : 1)
  const speech =
    say === null || under === undefined || surface.columns - left < BUBBLE_ROOM ? null : (
      <Box position="absolute" top={isDesktop ? 0 : 1} left={left} right={0} flexDirection="row">
        {bubble(el, isDesktop, fitSay(say, surface.columns - left - (isDesktop ? BUBBLE_EDGES : 0)))}
      </Box>
    )

  /** The last slot drawn: the hovered one while its bubble shows. */
  const last = speech === null || under === undefined ? memo.slots.length : memo.slots.indexOf(under)

  const k = isDesktop ? STRIP.scale : 1
  const slots = figures.map(({ look, at }, i) => {
    const one = drawn[i]
    if (one === undefined || i > last) return null
    const reveal = Math.min(look.pose.reveal, one.reveal)
    let sprite: RenderElement
    if (isDesktop) {
      const c = blank(SCENE_W * k, (SPRITE_H + 1) * k)
      drawFigure(c, look, at, k, true, reveal)
      sprite = (
        <Box flexDirection="column" width={round3(c.width * STRIP.pixel)} flexShrink={0}>
          {pixelRows(el, c, STRIP.pixel)}
        </Box>
      )
    } else {
      // The whole Clawd, laptop and all, as the stage draws it: three rows.
      const c = blank(SCENE_W, SPRITE_H + 1)
      drawFigure(c, look, at, 1, false, reveal)
      sprite = (
        <Box flexDirection="column" width={STRIP_CELLS} flexShrink={0}>
          {quadRows(el, c)}
        </Box>
      )
    }
    return (
      <Box flexDirection="row" flexShrink={0} alignItems="flex-start" marginLeft={i === 0 ? roamX : gap}>
        {sprite}
        {aside(one)}
      </Box>
    )
  })
  return (
    <Box flexDirection="row" width="100%" alignItems="flex-end">
      {slots}
      {drawn.length > last ? null : count}
      {speech}
    </Box>
  )
}

// ── The hover's bubble ────────────────────────────────────────────────────
//
// Paper in the app's text colour and words in its inverse: light on the dark
// theme, dark on the light one. On the desktop it is pixel art on the
// strip's grid, a pixel as wide as two canvas pixels and as tall as one: its
// corners step in twice, and a tail of steps points back at the Clawd. A
// terminal says it in plain words beside the Clawd: a font draws block
// glyphs shorter than the row a background fills, so paper there shows seams.

/** What a hover's bubble says: the name, what it is doing, then what it was asked, cut first. */
type Say = { name: string; doing: string; task: string }

const PAPER = 'text'
const WORDS = 'inverseText'
const BUBBLE = { px: round3(STRIP.pixel * 2), py: tall(STRIP.pixel) }
/** The tail's rows, top to bottom: how many pixels each reaches out from the bubble. */
const TAIL = [1, 2, 3, 2, 1]
/** The least room the strip must have right of a Clawd for its bubble, in cells. */
const BUBBLE_ROOM = 10

/** A desktop bubble's cells besides its words: the tail, the padding either side, and a cell to spare. */
const BUBBLE_EDGES = Math.ceil(3 * BUBBLE.px) + 3

/**
 * What a bubble says, cut to `room` cells so its paper hugs the words: the
 * task goes first, then what it is doing, each ending in an ellipsis. A
 * surface left to cut it drops whole runs, and the paper stays wide and blank.
 */
function fitSay(say: Say, room: number): Say {
  const cut = (text: string, n: number) => ([...text].length <= n ? text : n <= 1 ? '' : `${[...text].slice(0, n - 1).join('').trimEnd()}…`)
  const name = cut(say.name, room)
  let left = room - [...name].length
  const doing = say.doing === '' || left < 4 ? '' : cut(say.doing, left - 2)
  left -= doing === '' ? 0 : 2 + [...doing].length
  const task = say.task === '' || left < 8 ? '' : cut(say.task, left - 5)
  return { name, doing, task }
}

function bubble(el: Elements, isDesktop: boolean, say: Say): RenderElement {
  const { Box, Text } = el
  const words = (pad: string) => (
    <Text wrap="truncate-end" color={WORDS}>
      {pad}
      <Text bold color={WORDS}>
        {say.name}
      </Text>
      {say.doing === '' ? '' : `  ${say.doing}`}
      {say.task === '' ? null : (
        <Text dimColor color={WORDS}>{`  ·  ${say.task}`}</Text>
      )}
      {pad}
    </Text>
  )
  if (!isDesktop) {
    return (
      <Box flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text bold color="text">
            {say.name}
          </Text>
          {say.doing === '' ? null : <Text color="inactive">{`  ${say.doing}`}</Text>}
          {say.task === '' ? null : <Text color="subtle">{`  ·  ${say.task}`}</Text>}
        </Text>
      </Box>
    )
  }
  const { px, py } = BUBBLE
  /** One row of the stepped corners: the paper, `inset` pixels in from each end. */
  const edge = (inset: number) => (
    <Box height={py} flexShrink={0} marginLeft={round3(inset * px)} marginRight={round3(inset * px)} backgroundColor={PAPER} />
  )
  return (
    <Box flexDirection="row" alignItems="center" flexShrink={1} minWidth={0}>
      <Box flexDirection="column" width={round3(3 * px)} flexShrink={0}>
        {TAIL.map(n => (
          <Box height={py} width={round3(n * px)} marginLeft={round3((3 - n) * px)} flexShrink={0} backgroundColor={PAPER} />
        ))}
      </Box>
      <Box flexDirection="column" flexShrink={1} minWidth={0}>
        {edge(2)}
        {edge(1)}
        <Box height={1} paddingX={1} flexShrink={0} backgroundColor={PAPER}>
          {words('')}
        </Box>
        {edge(1)}
        {edge(2)}
      </Box>
    </Box>
  )
}

/** One tick of the strip: the Clawds drawn last step nearer their places; the frame's key. */
function stripTick(memo: Memo, props: StripProps, frame: number, hover: string | null, columns: number): string {
  const isDesktop = props.surface === 'desktop'
  const main = props.walkers[0]
  const isAlone = onStrip(memo, props.walkers, frame, hover).length === 1
  const room = columns - (isDesktop ? round3(SCENE_W * STRIP.pixel * STRIP.scale) : STRIP_CELLS) - ASIDE_W - ROAM_CLEAR
  roamTick(memo, main, isAlone, room, STRIDE[isDesktop ? 'desktop' : 'terminal'], frame, main !== undefined && hover === main.id)
  const all = onStrip(memo, props.walkers, frame, hover)
  const drawn = memo.cast.flatMap(id => all.filter(one => one.walker.id === id))
  const who = drawn.map(one => one.who)
  shuffle(memo, who, frame, hover)
  return stripKey(all, drawn, figuresOf(memo, who, frame, hover), roamAt(memo, drawn[0]?.walker.id, isDesktop))
}

/** Where Claude's slot starts while it wanders: in cells, whole ones in a terminal. */
function roamAt(memo: Memo, id: string | undefined, isDesktop: boolean): number {
  const r = memo.roam
  if (r === null || r.id !== id) return 0
  return isDesktop ? r.x : Math.round(r.x)
}

// ── The module ────────────────────────────────────────────────────────────

function tick(surface: Surface): void {
  const memo = memoOf(surface)
  memo.ticks += 1
  const props = memo.props
  if (props === null) return
  const hover = surface.state?.hover ?? null
  let next: string
  if (props.view === 'stage') {
    const cast = castNow(memo, props)
    shuffle(memo, cast, memo.ticks, hover)
    next = stageKey(figuresOf(memo, cast, memo.ticks, hover))
  } else {
    next = stripTick(memo, props, memo.ticks, hover, surface.columns)
  }
  if (next !== memo.shown) surface.setState({ frame: memo.ticks, hover })
}

function point(surface: Surface, event: { type: string; x: number }): void {
  const memo = memoOf(surface)
  const view = memo.props?.view
  if (view === undefined) return
  const state = surface.state ?? { frame: memo.ticks, hover: null }
  const slot = memo.slots.find(one => event.x >= one.from && event.x < one.to)
  const hover = event.type === 'leave' ? null : (slot?.id ?? null)
  if (event.type === 'down' && slot !== undefined) {
    surface.post(view === 'stage' ? { select: slot.id } : slot.id === MORE ? { open: true } : { open: true, focus: slot.id })
  }
  if (hover !== state.hover) {
    memo.hoverAt = memo.ticks
    surface.setState({ ...state, hover })
  }
}

const Clawd: ClientModule<ClawdProps, State> = (props, surface) => {
  const memo = memoOf(surface)
  memo.props = props
  if (surface.state === undefined) {
    surface.every(TICK_MS, () => tick(surface))
    surface.onPointer(event => point(surface, event))
    surface.setState({ frame: 0, hover: null })
  }
  remember(memo, props.view === 'stage' ? props.actors : props.walkers)
  const { Box } = surface.elements
  if (surface.columns <= 0) return <Box flexDirection="column" />
  const frame = memo.ticks
  const hover = surface.state?.hover ?? null
  if (props.view === 'stage') return stage(props, memo, frame, hover, surface)
  return strip(props, memo, frame, hover, surface)
}

export default Clawd
