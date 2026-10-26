// Pure helpers for the incident page: who did something, how a timeline entry reads, who may hold a role, and how to
// check an update before sending it. Shared with the mobile app: the wording from packages/i18n, the rest from
// packages/sync.
export {
  entryText,
  entryTime,
  people,
  personName,
  severityName,
  type People,
} from "@freecorps/brigade-i18n/incident";
export {
  assignable,
  bodyParts,
  checkUpdate,
  UPDATE_COUNT_FROM,
  updateLength,
  type BodyPart,
  type UpdateProblem,
} from "@freecorps/brigade-sync";
