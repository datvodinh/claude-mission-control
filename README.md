# Mission control

A [Claude Code](https://claude.com/claude-code) mod that puts your crew on screen. Claude and every subagent it starts get their own Clawd, live in a band above the prompt. One click opens Mission control: every agent at a glance, the context and the budget.

The Clawds stand on the session's context: a bar of what fills it (messages, tools, the system prompt, skills and free space), with how much is used, when it will auto-compact, and each part's share.

It runs in the desktop app and the terminal. On the desktop the Clawds are pixel art; in a terminal they're drawn in block characters, like the logo, three rows tall.

## Idle: Claude has the band to itself

When Claude is waiting on you and has no subagents, it wanders up and down the band. It stops to look around, hop, dance, stretch, twirl, duck into the floor and pop back up, or doze off for a bit.

| Desktop | Terminal |
| --- | --- |
| ![Claude wandering the desktop band, hopping, dancing and dozing](docs/idle-desktop.gif) | ![Claude wandering the terminal band](docs/idle-terminal.gif) |

## Napping

After three minutes with nothing to do, it falls properly asleep and snores.

| Desktop | Terminal |
| --- | --- |
| ![Claude asleep on the desktop band, snoring](docs/nap-desktop.gif) | ![Claude asleep on the terminal band](docs/nap-terminal.gif) |

## At work

When a turn starts, Claude scuttles back to its desk and types at its laptop. Each subagent it starts rises into the band, walks to a laptop of its own and gets typing too. The screen lights up while a tool runs.

| Desktop | Terminal |
| --- | --- |
| ![Claude typing, then two subagents joining and sitting at their laptops](docs/work-desktop.gif) | ![The same on the terminal band](docs/work-terminal.gif) |

## Hover: who is doing what

Point at a Clawd and it turns from its laptop to look at you, waving hello. Beside it, it says who it is, what it's doing and what it was asked: in a pixel speech bubble on the desktop, in plain words in a terminal. Move away and it goes back to work. Click a Clawd to open Mission control on it.

| Desktop | Terminal |
| --- | --- |
| ![A subagent and then Claude turning to face the pointer, each with a speech bubble](docs/hover-desktop.gif) | ![The same in a terminal, the words beside the Clawd](docs/hover-terminal.gif) |

## Done

A subagent that finishes cheers and hops, then sinks out of sight. One that fails droops and greys out first.

| Desktop | Terminal |
| --- | --- |
| ![A subagent cheering when it finishes, then sinking away](docs/done-desktop.gif) | ![The same on the terminal band](docs/done-terminal.gif) |

## Mission control

Click **Mission control** in the band, click a Clawd, or type `/mission`. The pane shows:

- the whole crew on stage
- a card for the newest agent at work, or whoever you pick: their task, what they're doing now and their latest tool calls
- the context: how much is used, what fills it and when it will auto-compact
- the budget: what this session has spent, and your 5-hour and weekly limits, with a pace check against each

| Desktop | Terminal |
| --- | --- |
| ![The Mission control pane: the stage, the spotlight card, the crew, the context and the budget](docs/pane-desktop.gif) | ![The pane in a terminal](docs/pane-terminal.gif) |

## Install

You need a Claude Code build that supports mods: a `plugin.json` plus a `hooks/register.tsx` module. It was built and tested on 2.1.289 and 2.1.292.

Clone it into your skills folder, and every new session loads it:

```bash
git clone https://github.com/datvodinh/claude-mission-control ~/.claude/skills/mission-control
```

To load it into a session that's already open, type `/reload-plugins`. To switch it off, delete the folder.

To try it for a single terminal session without installing:

```bash
claude --plugin-dir /path/to/claude-mission-control
```

## Develop

| File | What it does |
| --- | --- |
| `hooks/register.tsx` | Follows the session's events (turns, tool calls, subagents, usage), keeps the crew's state, and draws the band and the pane |
| `hooks/clawd.tsx` | The animated Clawds: sprites, moods, the idle wandering and the hover bubble, drawn on its own frame clock |
| `hooks/view.tsx` | The band's and the pane's layout |
| `hooks/budget.ts` | Spend, and pace checks against the rate-limit windows |
| `hooks/tools.ts`, `hooks/format.ts` | How tool calls and numbers read |
| `tests/mission-control.test.tsx` | The behaviour, tested on both surfaces |

```bash
claude plugin validate .
claude plugin test .
```

## License

[MIT](LICENSE)
