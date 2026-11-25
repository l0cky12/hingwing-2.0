/** `@highwing/hermes/domain`: what the renderer and `@highwing/thread` may import. Types, pure selectors, and the tables that name a target and its failures. */
export type * from './session'
export { EFFORTS, PLAIN_CONTROLS, reissues } from './session'
export {
  EXPORT_FORMATS, type Checkpoint, type CheckpointDiff, type Checkpoints, type Command, type ContextBreakdown, type ExportFormat, type Exported, type ModelConfirm, type ModelMenu, type Outcome as CommandOutcome, type Refusal, type Restored, type RestoreScope,
  type ResultOf
} from './command'
export { activityOf, turnActivityOf, type Activity, type TurnActivity } from './reduce'
export { offeredBy, sendPlan, type SendPlan } from './queue'
export { slashLineOf, type SlashCatalog, type SlashEntry } from './slash'
export {
  BOT_MARKS, BOT_TONES, botsIn, canonicalBotId, GENERATED_MAX_BYTES, isPetSlug, MARK_SETS, PICTURE_MAX_BYTES, PICTURE_RULE, pictureDataUrlOf, pictureTypeOf, rosterOf, shownUnasked, type AvatarTone, type Bot, type BotCreated, type BotDetails, type BotDraft, type BotEdit, type BotFacts, type BotFlag, type BotId, type BotMark, type Bots, type BotSection, type BotTone, type PetChoice, type PictureType, type Roster
} from './bots'
export type { PathMatch } from './path'
export { mentionedBots, mentionOf, typedMention } from './mention'
export type { Relay, RelayDesk, RelayId, RelayState } from './relay'
export type { ChatRef, OpenChat, Shown, Unstarted } from './open'
export { GROUP_NAME_MAX, GROUP_SIZE, groupIdFor, isGroupId, seatsFor, type GroupDraft, type GroupId, type GroupMember, type GroupRow, type Groups, type MemberId } from './groups'
export type { PaneAsk } from './pane'
export { label as versionLabel, type ChatVersions, type Landing, type Version, type Versions } from './versions'
export { modelViewOf, sameModel, type ModelView } from './model'
export { CHECK_FAILURES, STEP_WORDS, URL_FAILURES, URL_PROBLEMS, byKind, failureOf, firstStep, gatewayHost, isPlainHttp, machineOf, onThisComputer, parseGatewayUrl, parseSshHost, sameTarget, targetOf, type CheckFailure, type CheckStep, type Failure, type GatewayUrl, type ParsedUrl, type SetupFailure, type SshHost, type Target, type UrlFailure, type UrlProblem } from './reach'
