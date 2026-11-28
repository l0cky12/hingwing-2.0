import { RULE_KINDS, RULE_ORDER, shownBot, type RuleEdit, type RuleKind } from '@highwing/hermes/domain'
import { Fragment, useEffect, useId, useReducer, useRef, useState, type FormEvent } from 'react'
import { botIn } from '../bots/roster-view'
import { RemoveDialog } from '../composer/RemoveDialog'
import { commandRules, editCommandRule, run, useTopic } from '../store'
import { Segmented, type Segment } from './ConnectionCard'
import { addPlan, FIRST_RULES, nextRules, NOT_CONNECTED, POLL_MS, removalWords, rulesSectionOf, rulesWatch, type RulesSection, type RulesState } from './permissions-view'
import type { RowId } from './settings-view'

const ROWS: { readonly [K in RuleKind]: RowId } = { allow: 'allowed', deny: 'denied' }
const KINDS: readonly Segment<RuleKind>[] = RULE_ORDER.map(kind => ({ value: kind, label: RULE_KINDS[kind].adds, icon: null }))

/**
 * The shown bot's Always allowed and Denied lists, as its Hermes holds them. Hermes sends no event when they change, so the page
 * asks the config's token every few seconds and when the window comes back to the front, and reads the lists again only when it moved.
 */
export function CommandRulesCard({ off }: { readonly off: (row: RowId) => boolean }) {
  const bot = shownBot(useTopic('open'))
  const bots = useTopic('bots')
  const online = useTopic('link')?.state === 'online'
  const name = bot === null ? null : botIn(bots, bot)?.name ?? null
  const [state, dispatch] = useReducer(nextRules, FIRST_RULES)
  const [text, setText] = useState('')
  const [kind, setKind] = useState<RuleKind>('allow')
  const [tries, setTries] = useState(0)
  const latest = useRef(0)
  // Bumped on every bot switch, so a change that answers after A → B → A is not taken for the shown bot's.
  const view = useRef(0)

  useEffect(() => {
    view.current++
    dispatch({ on: 'otherBot' })
    if (!online) return
    let current = true
    const watch = rulesWatch({
      stamp: () => run({ do: 'configStamp', bot }),
      read: async () => {
        const asked = ++latest.current
        const outcome = await commandRules(bot)
        const taken = current && asked === latest.current
        if (taken) dispatch({ on: 'read', outcome })
        return taken && outcome.ok
      }
    })
    void watch.start()
    const timer = setInterval(() => void watch.look(false), POLL_MS)
    const onFocus = () => void watch.look(true)
    window.addEventListener('focus', onFocus)
    return () => {
      current = false
      latest.current++
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [online, bot, tries])

  const change = async (edit: RuleEdit) => {
    const at = view.current
    dispatch({ on: 'saving' })
    const outcome = await editCommandRule(bot, edit)
    if (view.current !== at) return
    // A read that started before this answer would draw the lists as they were.
    latest.current++
    dispatch({ on: 'saved', edit, outcome })
    if (outcome.ok && edit.change === 'add') setText('')
  }

  const section = online ? rulesSectionOf(state.read) : ({ show: 'note', words: NOT_CONNECTED } as const)
  return (
    <RuleLists
      name={name} section={section} state={state} text={text} kind={kind} off={off}
      onText={setText} onKind={setKind} onChange={edit => void change(edit)}
      onAsk={(askedKind, rule) => dispatch({ on: 'ask', kind: askedKind, rule })} onKeep={() => dispatch({ on: 'keep' })}
      onRetry={() => setTries(count => count + 1)}
    />
  )
}

export function RuleLists({ name, section, state, text, kind, off, onText, onKind, onChange, onAsk, onKeep, onRetry }: {
  readonly name: string | null
  readonly section: RulesSection
  readonly state: RulesState
  readonly text: string
  readonly kind: RuleKind
  readonly off: (row: RowId) => boolean
  readonly onText: (text: string) => void
  readonly onKind: (kind: RuleKind) => void
  readonly onChange: (edit: RuleEdit) => void
  readonly onAsk: (kind: RuleKind, rule: string) => void
  readonly onKeep: () => void
  readonly onRetry: () => void
}) {
  const ids = useId()
  const { saving, removing, problem, said } = state
  const rules = section.show === 'rules' ? section.rules : null
  const plan = addPlan(text, kind, rules ?? { allow: [], deny: [] })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (plan.edit !== null && !saving) onChange(plan.edit)
  }
  return (
    <>
      {section.show === 'reading' && <div className="row"><p className="desc">Asking Hermes…</p></div>}
      {section.show === 'note' && <div className="row"><p className="desc">{section.words}</p></div>}
      {section.show === 'failed' && (
        <div className="row">
          <p className="desc problem-line" role="alert">{section.words}</p>
          <div className="control"><button type="button" className="btn" onClick={onRetry}>Try again</button></div>
        </div>
      )}
      {rules !== null && (
        <>
          <div className="row" hidden={off('allowed') && off('denied')}>
            <p className="desc">Rules for {name ?? 'this bot'}. Each bot keeps its own, and a rule that denies wins over one that allows.</p>
          </div>
          {RULE_ORDER.map(each => {
            const facts = RULE_KINDS[each]
            const held = rules[each]
            return (
              <Fragment key={each}>
                <div className="row" hidden={off(ROWS[each])}>
                  <div className="text">
                    <p className="label" id={`${ids}-${each}`}>{facts.label}</p>
                    <p className="desc">{facts.desc}</p>
                    {held.length === 0 && <p className="desc">{facts.empty}</p>}
                  </div>
                </div>
                {held.length > 0 && (
                  <ul className="rules" aria-labelledby={`${ids}-${each}`} hidden={off(ROWS[each])}>
                    {held.map(rule => (
                      <li key={rule} className="row">
                        <code>{rule}</code>
                        <div className="control">
                          <button type="button" className="btn" aria-label={`Remove ${rule} from ${facts.label}`} disabled={saving} onClick={() => onAsk(each, rule)}>Remove</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Fragment>
            )
          })}
          <form className="row wrapped add-rule" hidden={off('add-rule')} onSubmit={submit}>
            <div className="text">
              <p className="label" id={`${ids}-add`}>Add a rule</p>
              <p className="desc" id={`${ids}-add-desc`}>Type a command, or a pattern with * for any text, and choose what Hermes does with it.</p>
            </div>
            <div className="control">
              <input
                type="text" aria-label="Rule to add" aria-describedby={`${ids}-add-desc`} autoComplete="off" spellCheck={false} placeholder="podman *"
                value={text} disabled={saving} onChange={event => onText(event.target.value)}
              />
              <Segmented labelledBy={`${ids}-add`} value={kind} segments={KINDS} onPick={onKind} />
              <button type="submit" className="btn primary" disabled={plan.edit === null || saving}>Add</button>
            </div>
            {plan.note !== null && <p className="desc">{plan.note}</p>}
          </form>
          {problem !== null && <div className="row"><p className="desc problem-line" role="alert">{problem}</p></div>}
          <p className="sr" role="status">{said}</p>
          {removing !== null && (
            <RemoveDialog
              {...removalWords(removing.kind, removing.rule)}
              onCancel={onKeep} onConfirm={() => onChange({ change: 'remove', kind: removing.kind, rule: removing.rule })}
            />
          )}
        </>
      )}
    </>
  )
}

