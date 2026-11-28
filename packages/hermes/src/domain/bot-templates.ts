import type { ApprovalMode } from './session'

/** Hermes toolset names (hermes-agent/toolsets.py) a template turns on, which `profiles.configure` takes as `enabled_toolsets`. */
export const TEMPLATE_TOOLSETS = ['terminal', 'file', 'clarify', 'skills', 'todo', 'web', 'browser', 'delegation', 'memory'] as const
export type TemplateToolset = typeof TEMPLATE_TOOLSETS[number]

export const TOOLSET_WORDS: { readonly [T in TemplateToolset]: string } = {
  terminal: 'Terminal', file: 'Files', clarify: 'Ask you questions', skills: 'Skills', todo: 'To-do list', web: 'Web', browser: 'Browser', delegation: 'Helpers', memory: 'Memory'
}

export type BotTemplateId = 'bot-builder' | 'deep-researcher' | 'nightly-repo-auditor'

export interface BotTemplate {
  readonly id: BotTemplateId
  /** The card's title. The bot's own name starts as `id`, because Hermes takes only lowercase letters, numbers, `-` and `_` for a profile's name. */
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

const RUN_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export const isRunTime = (time: string): boolean => RUN_TIME.test(time)

/** "02:00" as "2:00 AM". Text that is not HH:MM comes back as it was. */
export function timeWords(time: string): string {
  const match = RUN_TIME.exec(time)
  if (match === null) return time
  const hour = Number(match[1])
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`
}

export const scheduleWords = (time: string): string => `Runs nightly at ${timeWords(time)}`

export const toolWords = (toolsets: readonly TemplateToolset[]): string => toolsets.map(toolset => TOOLSET_WORDS[toolset]).join(', ')

/** The first sentence of the persona, which the setup dialog shows as the start of the personality. */
export const personaStart = (persona: string): string => /^.*?[.!?](?=\s|$)/s.exec(persona)?.[0] ?? persona

/** "02:00" as the cron line `0 2 * * *`, which runs every day at that time. null for text that is not HH:MM. */
export function cronOf(time: string): string | null {
  const match = RUN_TIME.exec(time)
  return match === null ? null : `${Number(match[2])} ${Number(match[1])} * * *`
}

/** What the person typed in the setup dialog. A template that does not run on a schedule ignores `folder` and `time`. */
export interface TemplateAnswers {
  readonly name: string
  readonly folder: string
  readonly time: string
}

export interface CreateStep {
  readonly step: 'create'
  readonly name: string
  readonly description: string
  readonly soul: string
}

export type SetupStep =
  | { readonly step: 'toolsets'; readonly toolsets: readonly TemplateToolset[] }
  | { readonly step: 'approval'; readonly mode: ApprovalMode }
  | { readonly step: 'job'; readonly name: string; readonly schedule: string; readonly prompt: string; readonly deliver: string }

/** The profile first, then what turns the new bot into the template. */
export type TemplatePlan = readonly [CreateStep, ...SetupStep[]]

export const AUDIT_JOB_NAME = 'Nightly audit'

/** The prompt a nightly audit job sends the bot, for a repository folder on the machine Hermes runs on. */
export const auditPrompt = (repoFolder: string): string =>
  [
    `Audit the repository at ${repoFolder}. Work read-only.`,
    '1. Run `git fetch`. Never pull or merge.',
    '2. Review the commits from the last 24 hours.',
    "3. Run the project's tests and lint if it has them.",
    '4. Check its dependencies for known security problems with the tools it already uses.',
    '5. Look for passwords or keys committed by mistake.',
    'Write a short report in this chat, ranked by severity, and compare it with your last report.',
    'Never edit files, commit or push.'
  ].join('\n')

/** The steps that make a bot from `template`, or null while `answers` leave one out: a blank name, and for a scheduled template a blank folder or a time that is not HH:MM. */
export function templatePlan(template: BotTemplate, answers: TemplateAnswers): TemplatePlan | null {
  const name = answers.name.trim()
  const folder = answers.folder.trim()
  const schedule = cronOf(answers.time)
  if (name === '') return null
  const steps: SetupStep[] = [
    { step: 'toolsets', toolsets: template.toolsets },
    { step: 'approval', mode: template.approval }
  ]
  if (template.schedule !== null) {
    if (folder === '' || schedule === null) return null
    steps.push({ step: 'job', name: AUDIT_JOB_NAME, schedule, prompt: auditPrompt(folder), deliver: 'bot-chat' })
  }
  return [{ step: 'create', name, description: template.summary, soul: template.persona }, ...steps]
}
