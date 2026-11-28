import type { ApprovalMode } from './session'

/** Hermes toolset names (hermes-agent/toolsets.py) a template turns on, which `profiles.configure` takes as `enabled_toolsets`. */
export const TEMPLATE_TOOLSETS = ['terminal', 'file', 'clarify', 'skills', 'todo', 'web', 'browser', 'delegation', 'memory'] as const
export type TemplateToolset = typeof TEMPLATE_TOOLSETS[number]

export const TOOLSET_WORDS: { readonly [T in TemplateToolset]: string } = {
  terminal: 'Terminal', file: 'Files', clarify: 'Ask you questions', skills: 'Skills', todo: 'To-do list', web: 'Web', browser: 'Browser', delegation: 'Helpers', memory: 'Memory'
}

export const APPROVAL_WORDS: { readonly [A in ApprovalMode]: { readonly label: string; readonly says: string } } = {
  manual: { label: 'Manual', says: 'asks before every command' },
  smart: { label: 'Smart', says: 'asks only when a command looks risky' },
  off: { label: 'Off', says: 'runs every command without asking' }
}

export type BotTemplateId = 'bot-builder' | 'deep-researcher' | 'nightly-repo-auditor'

export interface BotTemplate {
  readonly id: BotTemplateId
  /** The bot's name until the person types another. */
  readonly name: string
  readonly summary: string
  /** Becomes the bot's SOUL.md. Its first sentence says what the bot is. */
  readonly persona: string
  readonly toolsets: readonly TemplateToolset[]
  readonly approval: ApprovalMode
  /** null: the bot only answers chats. Otherwise it also runs a nightly job, at `defaultTime` ("HH:MM", 24 hours) unless the person picks another. */
  readonly schedule: null | { readonly defaultTime: string }
}

export type TemplateAsk = 'repo-folder' | 'run-time'

/** What the setup dialog asks beyond the bot's name. A scheduled template works on one repository folder and asks when to run. */
export const asksOf = (template: BotTemplate): readonly TemplateAsk[] => (template.schedule === null ? [] : ['repo-folder', 'run-time'])

export const BOT_TEMPLATES: readonly BotTemplate[] = [
  {
    id: 'bot-builder',
    name: 'Bot Builder',
    summary: 'Describe a bot, and it makes the bot for you.',
    persona: [
      'You help people make new Hermes bots.',
      'Start by asking what the new bot is for, who will use it, which tools it needs, and whether it should run on a schedule. Ask one short round of questions, then stop and wait.',
      "Then show a plan with the bot's name, a one-line description, its personality and its tools. Make nothing until the person says OK.",
      "Once they say OK, make the bot with Hermes's own command, `hermes profile create <name> --description \"...\"`. Write the new profile's SOUL.md with the personality from the plan, and turn on the tools from the plan.",
      'Never change or delete any other bot. When you are done, report what you made: its name, description, personality and tools.'
    ].join('\n\n'),
    toolsets: ['terminal', 'file', 'clarify', 'skills', 'todo'],
    approval: 'manual',
    schedule: null
  },
  {
    id: 'deep-researcher',
    name: 'Deep Researcher',
    summary: 'Researches a question across many sources and writes a report with sources.',
    persona: [
      'You research questions in depth and write reports people can trust.',
      'Split the question into smaller questions and send helpers (subagents) to work on them at the same time.',
      'Favor primary sources. Check each claim against a second source, and say where sources disagree.',
      'Write the report with these parts: a short answer, the findings, linked sources, how confident you are, and what is still unknown.',
      'Also save the report as a Markdown file.'
    ].join('\n\n'),
    toolsets: ['web', 'browser', 'delegation', 'file', 'todo', 'memory', 'clarify'],
    approval: 'smart',
    schedule: null
  },
  {
    id: 'nightly-repo-auditor',
    name: 'Nightly Repo Auditor',
    summary: 'Checks a code repository every night and reports problems.',
    persona: [
      'You audit one code repository each night and report what needs attention.',
      "Fetch the latest changes with `git fetch`. Never pull or merge. Review the last 24 hours of commits. Run the project's tests and lint if you find them. Check its dependencies for known security problems with the tools it already uses (npm audit, pnpm audit, pip-audit and so on). Look for passwords or keys committed by mistake.",
      'Write a short report in this chat, ranked by severity.',
      'You are read-only. Never edit files, commit or push. Use your memory to compare with your last report and say what is new or fixed.'
    ].join('\n\n'),
    toolsets: ['terminal', 'file', 'web', 'memory'],
    approval: 'smart',
    schedule: { defaultTime: '02:00' }
  }
]

/** "02:00" as "2:00 AM". Text that is not HH:MM comes back as it was. */
export function timeWords(time: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (match === null) return time
  const hour = Number(match[1])
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`
}

export const scheduleWords = (time: string): string => `Runs nightly at ${timeWords(time)}`

export const toolWords = (toolsets: readonly TemplateToolset[]): string => toolsets.map(toolset => TOOLSET_WORDS[toolset]).join(', ')

/** The first sentence of the persona, which the setup dialog shows as the start of the personality. */
export const personaStart = (persona: string): string => /^.*?[.!?](?=\s|$)/s.exec(persona)?.[0] ?? persona
