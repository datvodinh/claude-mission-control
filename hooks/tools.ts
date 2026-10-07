// What a tool call is doing, in a few words: "Reading app.tsx", "Running bun
// test". The badge is what a Clawd's speech bubble says while it runs.

import { baseName, shorten } from './format'

type Input = Readonly<Record<string, unknown>>

const text = (input: Input, key: string): string | null => {
  const value = input[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

const VERBS: Record<string, string> = {
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Write: 'Writing',
  NotebookEdit: 'Editing',
  Bash: 'Running',
  BashOutput: 'Watching',
  KillShell: 'Stopping',
  Grep: 'Searching',
  Glob: 'Finding',
  WebFetch: 'Fetching',
  WebSearch: 'Searching the web',
  Agent: 'Delegating',
  Task: 'Delegating',
  TodoWrite: 'Planning',
  AskUserQuestion: 'Asking you',
  ExitPlanMode: 'Presenting a plan',
  Skill: 'Using',
  SendMessage: 'Messaging',
  ToolSearch: 'Loading tools',
}

/** Tools that wait on the person while they run. */
export const ASKING = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** Tools that wait on subagents while they run. */
export const DELEGATING = new Set(['Agent', 'Task'])

function mcpParts(tool: string): [string, string] | null {
  const found = /^mcp__(.+?)__(.+)$/.exec(tool)
  return found === null ? null : [found[1] ?? '', found[2] ?? '']
}

/** The argument worth showing: a file's name, a command, a pattern, a host. */
export function detailOf(tool: string, input: Input): string | null {
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write': {
      const path = text(input, 'file_path')
      return path === null ? null : baseName(path)
    }
    case 'NotebookEdit': {
      const path = text(input, 'notebook_path')
      return path === null ? null : baseName(path)
    }
    case 'Bash': {
      const command = text(input, 'command')
      if (command === null) return null
      const line = (command.split('\n')[0] ?? '').replace(/^cd\s+\S+\s*&&\s*/, '')
      return shorten(line, 48)
    }
    case 'Grep': {
      const pattern = text(input, 'pattern')
      return pattern === null ? null : `"${shorten(pattern, 32)}"`
    }
    case 'Glob':
      return text(input, 'pattern')
    case 'WebFetch': {
      const url = text(input, 'url')
      if (url === null) return null
      const host = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)
      return host?.[1] ?? shorten(url, 32)
    }
    case 'WebSearch': {
      const query = text(input, 'query')
      return query === null ? null : `"${shorten(query, 32)}"`
    }
    case 'Agent':
    case 'Task':
      return text(input, 'description')
    case 'TodoWrite': {
      const todos = input.todos
      return Array.isArray(todos) ? `${todos.length} todos` : null
    }
    case 'AskUserQuestion': {
      const questions = input.questions
      const first = Array.isArray(questions) ? (questions[0] as Input | undefined) : undefined
      const question = first === undefined ? null : text(first, 'question')
      return question === null ? null : shorten(question, 48)
    }
    case 'Skill':
      return text(input, 'skill') ?? text(input, 'command')
    case 'SendMessage':
      return text(input, 'to') ?? text(input, 'recipient')
    default: {
      const mcp = mcpParts(tool)
      return mcp === null ? null : mcp[1].replace(/_/g, ' ')
    }
  }
}

export function verbOf(tool: string): string {
  const known = VERBS[tool]
  if (known !== undefined) return known
  const mcp = mcpParts(tool)
  return mcp === null ? `Using ${tool}` : `Calling ${mcp[0]}`
}

/** What a tool call reads as: `Reading app.tsx`. */
export function captionOf(tool: string, detail: string | null): string {
  return detail === null ? verbOf(tool) : `${verbOf(tool)} ${detail}`
}

/** The speech-bubble word: the tool, or an MCP tool's server. */
export function badgeOf(tool: string): string {
  const mcp = mcpParts(tool)
  return shorten(mcp === null ? tool : mcp[0], 12)
}
