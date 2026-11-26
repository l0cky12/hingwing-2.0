import { shownGroup, type Bot, type Bots, type GroupId, type GroupMember, type Groups, type OpenChat } from '@highwing/hermes/domain'
import { answeringWords, namesInWords, type NameOf } from '@highwing/thread'
import { botIn } from '../bots/roster-view'

export const faceOf = (member: GroupMember, bots: Bots | undefined): Bot =>
  botIn(bots, member.bot) ?? { id: member.bot, name: member.name, preview: null, description: null, tone: 'slate', picture: false, pinned: false, hidden: false }

export const namesFrom = (bots: Bots | undefined): NameOf => member => faceOf(member, bots).name

const STACK_SLOTS = 3

export interface GroupRowView {
  readonly id: GroupId
  readonly name: string
  readonly faces: readonly Bot[]
  readonly more: number
  /** "Ada, Sam and Juno", or "Sam is thinking" while a member answers. */
  readonly preview: string
  /** The preview says who is answering now, so it is drawn in the signal colour. */
  readonly live: boolean
  /** This is the open chat. */
  readonly current: boolean
  /** "Launch plan, group chat with Ada, Sam and Juno" */
  readonly label: string
}

export function groupRowsOf(groups: Groups | undefined, bots: Bots | undefined, open: OpenChat | undefined): readonly GroupRowView[] {
  if (groups?.state !== 'listed') return []
  const shown = shownGroup(open)
  return groups.rows.map(({ id, name, members, answering }) => {
    const faces = members.map(member => faceOf(member, bots))
    const stacked = faces.length > STACK_SLOTS ? STACK_SLOTS - 1 : faces.length
    const names = namesInWords(faces.map(face => face.name))
    const live = answeringWords(answering, members, namesFrom(bots))
    return { id, name, faces: faces.slice(0, stacked), more: faces.length - stacked, preview: live ?? names, live: live !== null, current: id === shown, label: `${name}, group chat with ${names}` }
  })
}
