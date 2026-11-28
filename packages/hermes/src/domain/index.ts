/** `@highwing/hermes/domain`: what the renderer and `@highwing/thread` may import. Types, pure selectors, and the tables that name a target and its failures. */
export type * from './session'
export { RECOMMENDED, STANDING_WORDS, betterAccount, standingOf, standingOfTarget, type AppAccount, type AppEntry, type AppSignIn, type AppStanding, type AppsBoard } from './apps'
export {
  asksOf, BOT_TEMPLATES, cronOf, isRunTime, personaStart, scheduleWords, TEMPLATE_TOOLSETS, templatePlan, timeWords, toolWords, TOOLSET_WORDS, type BotTemplate, type BotTemplateId, type SetupStep, type TemplateAnswers, type TemplateAsk,
  type TemplatePlan, type TemplateToolset
} from './bot-templates'
export { CONNECTOR_FILTERS, connectorsView, type ConnectorCard, type ConnectorFilter, type ConnectorShelf, type ConnectorsQuery, type ConnectorsSection, type ConnectorsView } from './connectors'
export { APPROVAL_MODES, APPROVAL_WORDS, EFFORTS, PLAIN_CONTROLS, reissues } from './session'
export {
  EXPORT_FORMATS, type Backup, type BotModelSettings, type Checkpoint, type CheckpointDiff, type Checkpoints, type Command, type ContextBreakdown, type ExportFormat, type Exported, type MemoryEntry, type ModelConfirm, type ModelMenu, type ModelSaved, type Outcome as CommandOutcome, type Recording, type Refusal, type Restored, type RestoreScope,
  type ResultOf, type AccountReport
} from './command'
export { activityOf, turnActivityOf, type Activity, type TurnActivity } from './reduce'
export { offeredBy, sendPlan, type SendPlan } from './queue'
export { slashLineOf, type SlashCatalog, type SlashEntry } from './slash'
export { quoteOf, withQuote, type Quote, type QuoteFrom } from './quote'
export {
  BOT_MARKS, BOT_TONES, botsIn, canonicalBotId, DELETES_BOTS, GENERATED_MAX_BYTES, isPetSlug, MARK_SETS, PICTURE_MAX_BYTES, PICTURE_RULE, pictureDataUrlOf, pictureTypeOf, rosterOf, shownUnasked, type AvatarTone, type Bot, type BotCreated, type BotDetails, type BotDraft, type BotEdit, type BotFacts, type BotFlag, type BotId, type BotMark, type Bots, type BotSection, type BotTone, type Marked, type PetChoice, type PictureType, type Roster
} from './bots'
export type { Added, Header, ServerSetup, ServerState, Tested, ToolServer } from './tool-servers'
export type { PathMatch } from './path'
export { isManagerName, MANAGER_NAMES, MANAGERS, type BotManagers, type FirstTime, type Manager, type ManagerFacts, type ManagerName, type ManagerState } from './passwords'
export { CATALOG_TIERS, parsePluginCatalog, pluginsView, type CatalogPlugin, type CatalogTier, type Plugin, type PluginInstalled, type PluginsView, type PluginSwitched } from './plugins'
export type { Toolset } from './toolsets'
export type { Skill, SkillLibrary } from './skills'
export { ROUTINE_ACTIONS, type Routine, type RoutineAction, type RoutineId } from './routines'
export { mentionedBots, mentionOf, typedMention } from './mention'
export type { Job, JobId } from './jobs'
export type { Relay, RelayDesk, RelayId, RelayState } from './relay'
export { shownBot, shownChat, shownGroup, type ChatRef, type OpenChat, type Shown, type ShownGroup, type Unstarted } from './open'
export {
  GROUP_NAME_MAX, GROUP_SIZE, groupIdFor, isGroupId, seatsFor, type Answering, type GroupChat, type GroupDraft, type GroupEvent, type GroupId, type GroupMember, type GroupRow, type Groups, type MemberId
} from './groups'
export { BOARD_PATH, isTaskId, parseTaskBoard, parseTaskChat, taskPath, type TaskBoard, type TaskCard, type TaskChat, type TaskColumn } from './tasks'
export type { PaneAsk } from './pane'
export { activityIn, botActivitiesOf, sameActivities, unreadAfter, type BotActivities, type BotActivity, type Busy, type BusyChats, type ChatBusy, type UnreadChat } from './activity'
export type { FoundMessage, MessagesRead } from './messages'
export type { Control, Screen, ScreenView } from './screen'
export { label as versionLabel, type ChatVersions, type Landing, type Version, type Versions } from './versions'
export { hermesVersionOf, type About, type HermesRelease } from './about'
export { modelViewOf, sameModel, type ModelView } from './model'
export { CHECK_FAILURES, STEP_WORDS, URL_FAILURES, URL_PROBLEMS, byKind, failureOf, firstStep, gatewayHost, isPlainHttp, machineOf, onThisComputer, parseGatewayUrl, hostPart, parseSshHost, sameTarget, targetOf, type CheckFailure, type CheckStep, type Failure, type GatewayUrl, type ParsedUrl, type SetupFailure, type SshHost, type Target, type UrlFailure, type UrlProblem } from './reach'
export { PICK_MODES, currentServer, hermesName, isPrivateHost, nextServers, rankWays, serverName, serversOf, wayLabel, type PickMode, type Server, type ServerEdit, type ServerId, type Servers, type Timed, type WayLabel } from './servers'
