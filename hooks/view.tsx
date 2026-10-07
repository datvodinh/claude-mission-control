// The band and the pane, as plain functions over a surface's element table.
//
// Every colour is a theme key, never a raw colour: the desktop maps each key
// onto its own design token and the terminal onto the person's theme, so
// both follow light, dark and custom themes. The animated parts (the stage
// and the band's strip of Clawds) are `Client`s the hooks module builds and
// hands in.

import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, RenderSurface, TextProps } from 'claude-code'

import type { Pace, Tone } from './budget'

export type Kit = {
  surface: RenderSurface
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export const INK: Record<Tone, string> = { ok: 'success', warn: 'warning', bad: 'error', muted: 'subtle' }

const isTerminal = (kit: Kit) => kit.surface === 'terminal'

/** Half a line between stacked parts on the desktop; none in a terminal. */
const breath = (kit: Kit, rows = 1) => (isTerminal(kit) ? 0 : rows)

function card(kit: Kit, ink: string | null): Partial<BoxProps> {
  if (isTerminal(kit)) return { borderStyle: 'round', borderColor: ink ?? 'subtle', paddingX: 1 }
  return ink === null ? { borderStyle: 'round' } : { borderStyle: 'round', borderColor: ink, borderDimColor: true }
}

function section(kit: Kit, title: string, children: RenderElement[], aside: RenderElement | null = null): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column" rowGap={breath(kit, 0.5)}>
      <Box flexDirection="row" alignItems="center">
        <Text bold color="inactive">
          {title}
        </Text>
        <Box flexGrow={1} />
        {aside}
      </Box>
      {children}
    </Box>
  )
}

/** Splits `columns` among shares by largest remainder, so the cells add up. */
function cellsOf(shares: readonly number[], columns: number): number[] {
  const total = shares.reduce((sum, one) => sum + one, 0)
  if (total <= 0) return shares.map(() => 0)
  const exact = shares.map(one => (one / total) * columns)
  const cells = exact.map(Math.floor)
  let left = columns - cells.reduce((sum, one) => sum + one, 0)
  const order = exact.map((one, i) => [one - Math.floor(one), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (left <= 0) break
    cells[i] = (cells[i] ?? 0) + 1
    left -= 1
  }
  return cells
}

/** A width the engine takes: a whole percent. */
const percent = (n: number) => `${Math.round(Math.max(0, Math.min(100, n)))}%`

// ── The band ──────────────────────────────────────────────────────────────
//
// The crew, alive, and the way in: the Clawds say who is at work and a hover
// names one and says what it is doing. Under them, the context they work in;
// the budget waits in the pane.

export type BandView = {
  /** The crew, animated: a Client the hooks build. */
  strip: RenderElement | null
  /** The context under the crew, as the pane shows it; null before the first reading. */
  context: ContextView | null
  /** Cells the context spans in a terminal. */
  width: number
}

export type BandActions = { open: () => void }

export function Band(kit: Kit, view: BandView, act: BandActions): RenderElement {
  const { Box, Button } = kit
  const crew = (
    <Box flexDirection="row" alignItems="center" width="100%" columnGap={2}>
      {view.strip ?? <Box flexGrow={1} />}
      <Box flexShrink={0}>
        {isTerminal(kit) ? (
          <Button key="open" label="Mission control" hotkey="m" onPress={act.open} />
        ) : (
          <Button key="open" plain label="Mission control" onPress={act.open} />
        )}
      </Box>
    </Box>
  )
  const ctx = view.context
  if (ctx === null) return crew
  if (isTerminal(kit)) {
    // Rows are dear here: the bar is the floor the crew stands on, and the
    // figures and what fills it share the row under it.
    return (
      <Box flexDirection="column" width="100%">
        {crew}
        {ctx.parts.length === 0 ? null : contextBar(kit, ctx.parts, view.width)}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {[contextLine(kit, ctx), ...legendOf(kit, ctx.parts)]}
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" width="100%" rowGap={0.5}>
      {crew}
      {contextBlock(kit, ctx, view.width)}
    </Box>
  )
}

// ── The pane ──────────────────────────────────────────────────────────────

export type Spotlight = {
  id: string
  name: string
  color: string
  status: string
  tone: Tone
  elapsed: string
  task: string | null
  doing: { verb: string; detail: string | null } | null
  facts: string
  recent: { tool: string; detail: string | null; ago: string }[]
  isPinned: boolean
}

export type CrewRow = {
  id: string
  name: string
  color: string
  caption: string
  elapsed: string
  isEnded: boolean
  isPicked: boolean
}

export type ContextView = {
  used: string | null
  window: string | null
  compact: { text: string; tone: Tone } | null
  /** What fills the window, each a share of it, with its /context colour: what is used, then the free space. */
  parts: { name: string; share: number; color: string; kind: 'used' | 'free' | 'buffer' }[]
}


export type PaneView = {
  headline: string
  stage: RenderElement | null
  spotlight: Spotlight | null
  crew: CrewRow[]
  context: ContextView
  spend: string | null
  paces: Pace[]
  isBandHidden: boolean
  width: number
}

export type PaneActions = {
  close: () => void
  pick: (id: string) => void
  follow: () => void
  toggleBand: () => void
}

function spotlightCard(kit: Kit, spot: Spotlight, act: PaneActions): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="column" rowGap={breath(kit, 0.5)} {...card(kit, spot.color)}>
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Text color={spot.color}>●</Text>
        <Text bold wrap="truncate-end">
          {spot.name}
        </Text>
        <Box flexGrow={1} />
        <Text color={INK[spot.tone]}>{spot.status}</Text>
        <Text color="subtle">{spot.elapsed}</Text>
      </Box>
      {spot.task === null ? null : (
        <Text color="inactive" wrap="truncate-end">
          {spot.task}
        </Text>
      )}
      {spot.doing === null ? null : (
        <Text wrap="truncate-end">
          <Text color="permission">{spot.doing.verb}</Text>
          {spot.doing.detail === null ? '' : ` ${spot.doing.detail}`}
        </Text>
      )}
      <Text color="subtle" wrap="truncate-end">
        {spot.facts}
      </Text>
      {spot.recent.length === 0 ? null : (
        <Box flexDirection="column" marginTop={breath(kit, 0.5)}>
          {spot.recent.map(one => (
            <Box flexDirection="row" columnGap={1}>
              <Text wrap="truncate-end">
                <Text color="inactive">{one.tool}</Text>
                {one.detail === null ? '' : <Text color="subtle">{` ${one.detail}`}</Text>}
              </Text>
              <Box flexGrow={1} />
              <Text color="subtle">{one.ago}</Text>
            </Box>
          ))}
        </Box>
      )}
      {spot.isPinned ? (
        <Box flexDirection="row">
          <Button key="follow" plain label="Follow the action" onPress={act.follow} />
        </Box>
      ) : null}
    </Box>
  )
}

function crewList(kit: Kit, rows: CrewRow[], act: PaneActions): RenderElement {
  const { Box, Text, Button } = kit
  return section(
    kit,
    'Crew',
    rows.map(row => (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Text color={row.isEnded ? 'subtle' : row.color}>{row.isEnded ? '○' : '●'}</Text>
        <Button key={`pick:${row.id}`} plain label={row.name} onPress={() => act.pick(row.id)} />
        <Text color={row.isEnded ? 'subtle' : 'inactive'} wrap="truncate-end">
          {row.caption}
        </Text>
        <Box flexGrow={1} />
        <Text color="subtle">{row.elapsed}</Text>
      </Box>
    )),
  )
}

/** A terminal's bar: what is used a heavy rule, the free space a light one. */
const GLYPH = { used: '━', free: '─', buffer: '╌' }

/** What fills the context, as one bar of its parts' colours, `width` cells wide in a terminal. */
function contextBar(kit: Kit, parts: ContextView['parts'], width: number): RenderElement {
  const { Box, Text } = kit
  if (isTerminal(kit)) {
    return (
      <Text wrap="truncate">
        {cellsOf(
          parts.map(part => part.share),
          Math.max(10, width),
        ).map((cells, i) => {
          const part = parts[i]
          return part === undefined || cells === 0 ? null : <Text color={part.color}>{GLYPH[part.kind].repeat(cells)}</Text>
        })}
      </Text>
    )
  }
  return (
    <Box flexDirection="row" width="100%" height={0.4} overflow="hidden" flexShrink={0}>
      {cellsOf(
        parts.map(part => part.share),
        100,
      ).map((whole, i) => {
        const part = parts[i]
        return part === undefined || whole === 0 ? null : <Box width={percent(whole)} height={0.4} flexShrink={1} backgroundColor={part.color} />
      })}
    </Box>
  )
}

function composition(kit: Kit, parts: ContextView['parts'], width: number): RenderElement[] {
  const { Box, Text } = kit
  if (parts.length === 0) return []
  return [
    contextBar(kit, parts, width),
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {legendOf(kit, parts)}
    </Box>,
  ]
}

/** Each part that counts, by name and share: the five biggest used, then the free space. */
function legendOf(kit: Kit, parts: ContextView['parts']): RenderElement[] {
  const { Text } = kit
  const named = parts.filter(part => part.kind === 'used' && part.share >= 0.005).slice(0, 5)
  return [...named, ...parts.filter(part => part.kind !== 'used')].map(part => (
    <Text wrap="truncate-end">
      <Text color={part.color}>■</Text>
      <Text color="inactive">{` ${part.name} `}</Text>
      <Text color="subtle">{`${Math.round(part.share * 100)}%`}</Text>
    </Text>
  ))
}

/** How much is used of the window, and when it compacts. */
function contextLine(kit: Kit, ctx: ContextView): RenderElement {
  const { Text } = kit
  return (
    <Text wrap="truncate-end">
      {ctx.used === null ? (
        <Text color="subtle">No reading yet: the context shows after Claude's first reply.</Text>
      ) : (
        [<Text bold>{ctx.used}</Text>, <Text color="subtle">{` of ${ctx.window ?? '?'} used`}</Text>]
      )}
      {ctx.compact === null ? null : [<Text color="subtle"> · </Text>, <Text color={INK[ctx.compact.tone]}>{ctx.compact.text}</Text>]}
    </Text>
  )
}

/** How much is used, when it compacts, and what fills it: the pane's Context, and the band's. */
function contextBlock(kit: Kit, ctx: ContextView, width: number): RenderElement[] {
  return [contextLine(kit, ctx), ...composition(kit, ctx.parts, width)]
}

function paceBar(kit: Kit, pace: Pace, width: number): RenderElement {
  const { Box, Text } = kit
  const used = Math.max(0, Math.min(100, pace.percent))
  const gone = pace.elapsed
  const ink = INK[pace.tone === 'muted' ? 'ok' : pace.tone]
  if (isTerminal(kit)) {
    const cells = Math.round((used / 100) * width)
    const mark = gone === null ? -1 : Math.min(width - 1, Math.round((gone / 100) * (width - 1)))
    const glyphs: RenderElement[] = []
    for (let i = 0; i < width; i++) {
      if (i === mark) glyphs.push(<Text color="text">│</Text>)
      else glyphs.push(<Text color={i < cells ? ink : 'promptBorder'}>{i < cells ? '━' : '─'}</Text>)
    }
    return <Text>{glyphs}</Text>
  }
  // Used, then the rest of the window; the time gone is a tick across the
  // bar, and what is used past it (ahead of pace) is drawn as a warning.
  const mark = gone === null ? null : Math.max(0, Math.min(100, gone))
  const segments: { share: number; ink: string }[] =
    mark === null
      ? [
          { share: used, ink },
          { share: 100 - used, ink: 'promptBorder' },
        ]
      : used <= mark
        ? [
            { share: used, ink },
            { share: mark - used, ink: 'promptBorder' },
            { share: -1, ink: 'text' },
            { share: 100 - mark, ink: 'promptBorder' },
          ]
        : [
            { share: mark, ink },
            { share: -1, ink: 'text' },
            { share: used - mark, ink: 'warning' },
            { share: 100 - used, ink: 'promptBorder' },
          ]
  const wholes = cellsOf(
    segments.map(one => Math.max(0, one.share)),
    100,
  )
  return (
    <Box flexDirection="row" width={width} height={0.9} flexShrink={0} overflow="hidden" alignItems="center">
      {segments.map((one, i) =>
        one.share < 0 ? (
          <Box width={0.25} height={0.9} flexShrink={0} backgroundColor={one.ink} />
        ) : (wholes[i] ?? 0) === 0 ? null : (
          <Box width={percent(wholes[i] ?? 0)} height={0.45} flexShrink={1} backgroundColor={one.ink} />
        ),
      )}
    </Box>
  )
}

export function Pane(kit: Kit, view: PaneView, act: PaneActions): RenderElement {
  const { Box, Text, Button } = kit
  const ctx = view.context
  const barWidth = isTerminal(kit) ? 12 : 14

  return (
    <Box flexDirection="column" width="100%" rowGap={breath(kit, 2)}>
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Text color="inactive" wrap="truncate-end">
          {view.headline}
        </Text>
        <Box flexGrow={1} />
        {isTerminal(kit) ? <Button key="close" label="Close" hotkey="q" onPress={act.close} /> : null}
      </Box>

      {view.stage}

      {view.spotlight === null ? null : spotlightCard(kit, view.spotlight, act)}

      {view.crew.length > 1 ? crewList(kit, view.crew, act) : null}

      {section(kit, 'Context', contextBlock(kit, ctx, view.width - 4))}

      {section(kit, 'Budget', [
        <Text wrap="truncate-end">
          {view.spend === null ? <Text color="subtle">No spend recorded yet</Text> : <Text bold>{view.spend}</Text>}
          {view.spend === null ? null : <Text color="subtle"> this session</Text>}
        </Text>,
        ...view.paces.map(pace => (
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            <Box width={isTerminal(kit) ? 7 : 9} flexShrink={0}>
              <Text color="inactive" wrap="truncate-end">
                {pace.label}
              </Text>
            </Box>
            {paceBar(kit, pace, barWidth)}
            <Box width={5} flexShrink={0} justifyContent="flex-end">
              <Text bold>{`${Math.round(pace.percent)}%`}</Text>
            </Box>
            <Text color={INK[pace.tone]} wrap="truncate-end">
              {pace.verdict}
            </Text>
          </Box>
        )),
      ])}

      <Box flexDirection="row">
        <Button key="band" plain label={view.isBandHidden ? 'Show the band above the prompt' : 'Hide the band above the prompt'} onPress={act.toggleBand} />
      </Box>
    </Box>
  )
}
