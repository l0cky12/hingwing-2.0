import type { Bot, GroupMember } from '@highwing/hermes/domain'
import { namesInWords, type GroupItemView, type GroupThreadView } from '@highwing/thread'
import { Avatar } from '../bots/Avatar'
import { Markdown } from '../chat/text'

function Item({ item, face }: { readonly item: GroupItemView; readonly face: Bot }) {
  if (item.kind === 'note') return <p className={item.tone === 'error' ? 'err' : 'notice'}>{item.words}</p>
  return (
    <div className="said-by" role="group" aria-label={face.name}>
      <p className="relay-from"><Avatar bot={face} size={22} /><span>{face.name}</span></p>
      <div className="prose"><Markdown source={item.text} caret={false} nodeKey={item.key} /></div>
    </div>
  )
}

/** The open group's thread: each message, then one item per member's reply under it, and who is answering at its live end. */
export function GroupThread({ view, faceOf }: { readonly view: GroupThreadView; readonly faceOf: (member: GroupMember) => Bot }) {
  if (view.show === 'loading') return <div id="transcript" />
  if (view.show === 'note') return <div id="transcript"><p className="notice" role="status">{view.words}</p></div>
  const last = view.turns.length - 1
  return (
    <div id="transcript">
      {view.earlier && <p className="earlier">Older messages in this group chat aren’t shown.</p>}
      {view.turns.map((turn, at) => {
        const live = at === last ? view.live : null
        return (
          <article key={turn.key} className={turn.sending ? 'turn group-turn pending' : 'turn group-turn'}>
            {turn.time !== null && <p className="when">{turn.time}</p>}
            {turn.request !== null && <p className="request">{turn.request}</p>}
            {(turn.items.length > 0 || live !== null) && (
              <div className="thread">
                {turn.items.map(item => <Item key={item.key} item={item} face={faceOf(item.member)} />)}
                {live !== null && <div className="tip thinking" role="status"><span className="glyph" />{live}</div>}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}

/** The top bar's right end while a group is open: its members' faces and names. */
export function GroupMembers({ faces }: { readonly faces: readonly Bot[] }) {
  return (
    <span className="members">
      <span className="stack" aria-hidden="true">{faces.map(face => <Avatar key={face.id} bot={face} size={22} />)}</span>
      {namesInWords(faces.map(face => face.name))}
    </span>
  )
}
