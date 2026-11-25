import type { Bot, Bots, GroupId, GroupMember, Groups } from '@highwing/hermes/domain'
import { botIn } from '../bots/roster-view'

export const namesInWords = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

export const faceOf = (member: GroupMember, bots: Bots | undefined): Bot =>
  botIn(bots, member.bot) ?? { id: member.bot, name: member.name, preview: null, description: null, tone: 'slate', picture: false }

const STACK_SLOTS = 3

export interface GroupRowView {
  readonly id: GroupId
  readonly name: string
  readonly faces: readonly Bot[]
  readonly more: number
  readonly preview: string
}

export function groupRowsOf(groups: Groups | undefined, bots: Bots | undefined): readonly GroupRowView[] {
  if (groups?.state !== 'listed') return []
  return groups.rows.map(({ id, name, members }) => {
    const faces = members.map(member => faceOf(member, bots))
    const shown = faces.length > STACK_SLOTS ? STACK_SLOTS - 1 : faces.length
    return { id, name, faces: faces.slice(0, shown), more: faces.length - shown, preview: namesInWords(faces.map(face => face.name)) }
  })
}
