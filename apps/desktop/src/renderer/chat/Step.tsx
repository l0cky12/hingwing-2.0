import type { DiffStat, RecordSection, StepView } from '@highwing/thread'
import { CopyButton } from './Copy'
import { PhraseText } from './text'

export const cx = (...names: readonly (string | false | null)[]) => names.filter(Boolean).join(' ')

export function Stat({ stat }: { readonly stat: DiffStat | null }) {
  if (stat === null || (stat.added === 0 && stat.removed === 0)) return null
  return (
    <span className="stat">
      {stat.added > 0 && <span className="plus">+{stat.added}</span>}
      {stat.added > 0 && stat.removed > 0 && ' '}
      {stat.removed > 0 && <span className="minus">−{stat.removed}</span>}
    </span>
  )
}

const DIFF_MARK = { add: '+', del: '−', ctx: ' ' } as const

const COPY_NAME = { output: 'Copy output', result: 'Copy result', input: 'Copy input' } as const

function Section({ section, open }: { readonly section: RecordSection; readonly open: boolean }) {
  const label = section.label === null ? null : <h4>{section.label}</h4>
  const copy = open && section.copy !== null
    ? <CopyButton text={section.copy} name={section.kind === 'changes' ? `Copy changes to ${section.path}` : COPY_NAME[section.kind]} />
    : null
  if (section.kind === 'changes') {
    return (
      <section>
        {label}
        {copy}
        <p className="path">{section.path}</p>
        <pre className="diff">
          {section.lines.map((line, index) => line.t === 'hunk'
            ? <span key={index} className="ln hunk">{line.text}</span>
            : <span key={index} className={`ln ${line.t}`}><span className="mk">{DIFF_MARK[line.t]}</span>{line.text}</span>)}
        </pre>
      </section>
    )
  }
  const { body } = section
  return (
    <section>
      {label}
      {copy}
      {'empty' in body
        ? <p className="empty">{body.empty}</p>
        : <pre>{body.text}{body.more > 0 && `\n… ${body.more} more characters`}</pre>}
    </section>
  )
}

interface StepProps {
  readonly step: StepView
  readonly live: boolean
  readonly open: boolean
  readonly onToggle: (key: string) => void
}

export function Step({ step, live, open, onToggle }: StepProps) {
  const title = <span className="title"><PhraseText words={step.title} /></span>
  const meta = <span className="meta"><Stat stat={step.stat} />{step.duration !== null && <span className="dur">{step.duration}</span>}</span>
  const end = live ? { 'data-end': 'live' } : {}
  if (step.record === null) {
    return <div className={cx('step', step.state, live && 'live')} {...end}><div className="head">{title}{meta}</div></div>
  }
  const [only] = step.record.sections
  const bare = step.record.sections.length === 1 && only !== undefined && only.kind !== 'changes' && 'empty' in only.body
  return (
    <div className={cx('step', step.state, open && 'open', live && 'live')} {...end}>
      <button className="head" aria-expanded={open} onClick={() => onToggle(step.key)}>
        {title}<span className="chev" aria-hidden="true" />{meta}
      </button>
      <div className={cx('record', bare && 'bare')}>
        {step.record.sections.map((section, index) => <Section key={index} section={section} open={open} />)}
      </div>
    </div>
  )
}
