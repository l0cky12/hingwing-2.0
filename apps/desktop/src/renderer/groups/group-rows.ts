import type { Bot, Bots, GroupId, GroupMember, Groups } from '@highwing/hermes/domain'
import { botIn } from '../bots/roster-view'

/** "Ada", "Ada and Sam", "Ada, Sam and Juno". */
export const namesInWords = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** A member drawn: the roster's bot while it lists it, so the avatar matches the sidebar, else the seat's own name in a plain tone. */
export const faceOf = (member: GroupMember, bots: Bots | undefined): Bot =>
  botIn(bots, member.bot) ?? { id: member.bot, name: member.name, preview: null, description: null, tone: 'slate', picture: false }

/** The avatar stack has three places, so the names of every row line up. A group of more fills the third with "+N". */
const PLACES = 3

export interface GroupRowView {
  readonly id: GroupId
  readonly name: string
  readonly faces: readonly Bot[]
  /** How many members `faces` leaves out. 0: none, and no "+N". */
  readonly more: number
  /** "Ada, Sam and Juno". */
  readonly preview: string
}

/** The Group chats section's rows. Empty: the section is not drawn, as on a Hermes with no group chats. */
export function groupRowsOf(groups: Groups | undefined, bots: Bots | undefined): readonly GroupRowView[] {
  if (groups?.state !== 'listed') return []
  return groups.rows.map(({ id, name, members }) => {
    const faces = members.map(member => faceOf(member, bots))
    const shown = faces.length > PLACES ? PLACES - 1 : faces.length
    return { id, name, faces: faces.slice(0, shown), more: faces.length - shown, preview: namesInWords(faces.map(face => face.name)) }
  })
}
