import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { botsIn, type BotId, type Bots, type Skill } from '@highwing/hermes/domain'
import { run, useTopic } from '../store'

type Opened = { readonly name: string; readonly text: string | null; readonly problem: string | null }
type Asked = { readonly bot: BotId | null; readonly skills: ReadonlyMap<string, boolean> }
const NONE: ReadonlyMap<string, boolean> = new Map()

export const nameOf = (bot: BotId | null, bots: Bots | undefined): string =>
  (bot !== null && bots?.state === 'listed' ? botsIn(bots.roster).find(listed => listed.id === bot)?.name : undefined) ?? 'This bot'

export function useSkillSwitches() {
  const library = useTopic('skills')
  const [asked, setAsked] = useState<Asked>({ bot: null, skills: NONE })
  const [problem, setProblem] = useState<{ readonly bot: BotId | null; readonly message: string } | null>(null)
  useEffect(() => {
    if (library?.state !== 'listed') return
    setAsked(held => {
      if (held.bot !== library.bot) return held
      const skills = new Map([...held.skills].filter(([skill, wanted]) => library.skills.find(listed => listed.name === skill)?.enabled !== wanted))
      return skills.size === held.skills.size ? held : { bot: held.bot, skills }
    })
  }, [library])
  const ask = (bot: BotId | null, skill: string, wanted: boolean | null) => setAsked(before => {
    if (wanted === null && before.bot !== bot) return before
    const skills = new Map(before.bot === bot ? before.skills : NONE)
    if (wanted === null) skills.delete(skill)
    else skills.set(skill, wanted)
    return { bot, skills }
  })
  const toggle = async ({ name: skill, enabled }: Skill) => {
    if (library === undefined) return
    const { bot } = library
    setProblem(null)
    ask(bot, skill, !enabled)
    const done = await run({ do: 'setSkill', bot, name: skill, enabled: !enabled })
    if (done.ok) return
    ask(bot, skill, null)
    setProblem({ bot, message: done.refusal.message })
  }
  return {
    library,
    pending: library !== undefined && asked.bot === library.bot ? asked.skills : NONE,
    problem: problem !== null && problem.bot === library?.bot ? problem.message : null,
    toggle
  }
}

export function Skills() {
  const { library, pending, problem, toggle } = useSkillSwitches()
  const bots = useTopic('bots')
  const [opened, setOpened] = useState<Opened | null>(null)
  if (library === undefined) return null
  const name = nameOf(library.bot, bots)

  const open = async (skill: string) => {
    setOpened({ name: skill, text: null, problem: null })
    const read = await run({ do: 'skillText', bot: library.bot, name: skill })
    setOpened(shown => shown?.name !== skill ? shown : read.ok ? { name: skill, text: read.value, problem: null } : { name: skill, text: null, problem: read.refusal.message })
  }

  return (
    <div className="card skills" aria-busy={library.state === 'reading'}>
      <div className="row">
        <div className="text">
          <p className="label">Skills {name} can use</p>
          <p className="desc">A skill turned off stays installed, and {name} won’t use it until you turn it on.</p>
        </div>
      </div>
      {library.state === 'reading' && <div className="row"><p className="desc">Reading skills…</p></div>}
      {library.state === 'failed' && <div className="row"><p className="desc" role="alert">{library.message}</p></div>}
      {library.state === 'listed' && library.skills.length === 0 && <div className="row"><p className="desc">{name} has no skills.</p></div>}
      {library.state === 'listed' && library.skills.map(skill => (
        <div key={skill.name} className="row skill">
          <div className="text">
            <p className="label">{skill.name}</p>
            {skill.description !== '' && <p className="desc one-line" title={skill.description}>{skill.description}</p>}
          </div>
          <div className="control">
            <button type="button" className="btn" aria-label={`Open ${skill.name}`} onClick={() => void open(skill.name)}>Open</button>
            <input
              type="checkbox" role="switch" aria-label={`Use ${skill.name}`} checked={pending.get(skill.name) ?? skill.enabled} disabled={pending.has(skill.name)}
              onChange={() => void toggle(skill)}
            />
          </div>
        </div>
      ))}
      {problem !== null && <div className="row"><p className="desc" role="alert">{problem}</p></div>}
      {opened !== null && <SkillDialog opened={opened} onClose={() => setOpened(null)} />}
    </div>
  )
}

function SkillDialog({ opened, onClose }: { readonly opened: Opened; readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const heading = useId()
  useLayoutEffect(() => {
    if (dialog.current?.open === false) {
      dialog.current.showModal()
      close.current?.focus()
    }
  }, [])
  return (
    <dialog ref={dialog} className="confirm-dialog skill-text" aria-labelledby={heading} onCancel={event => { event.preventDefault(); onClose() }}>
      <h2 id={heading}>{opened.name}</h2>
      {opened.problem !== null ? <p role="alert">{opened.problem}</p>
        : opened.text === null ? <p>Reading SKILL.md…</p>
        : <pre tabIndex={0} aria-label={`${opened.name} instructions`}>{opened.text}</pre>}
      <div className="actions">
        <button ref={close} type="button" onClick={onClose}>Close</button>
      </div>
    </dialog>
  )
}
