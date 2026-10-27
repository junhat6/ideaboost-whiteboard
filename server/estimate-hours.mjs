// IDs are deployment configuration fixed after owner-created field verification;
// never accepted from a browser request or inferred from a same-name Project field.
export function hoursContract(env) {
  if (env.ESTIMATE_HOURS_READ_ENABLED !== "true") return null;
  const id = Number(env.ESTIMATE_HOURS_FIELD_ID);
  const node = env.ESTIMATE_HOURS_NODE_ID,
    project = env.ESTIMATE_HOURS_PROJECT_FIELD_ID;
  return Number.isSafeInteger(id) &&
    id > 0 &&
    /^IFN_[A-Za-z0-9_-]+$/.test(node || "") &&
    /^PVTF_[A-Za-z0-9_-]+$/.test(project || "")
    ? { id, node, project }
    : null;
}
export const HOURS_META = `hoursField:field(name:"Estimate Hours") { __typename ... on ProjectV2Field { id name dataType isIssueField issueField { __typename ... on IssueFieldNumber { id fullDatabaseId name dataType visibility } } } }`;
export const HOURS_VALUE = `hoursValue:fieldValueByName(name:"Estimate Hours") { __typename ... on ProjectV2ItemIssueFieldValue { field { ... on ProjectV2Field { id } } issueFieldValue { __typename ... on IssueFieldNumberValue { value field { ... on IssueFieldNumber { id } } } } } }`;
export function publicHours(field, env) {
  const c = hoursContract(env),
    f = field?.issueField;
  return (
    !!c &&
    field?.__typename === "ProjectV2Field" &&
    field.id === c.project &&
    field.name === "Estimate Hours" &&
    field.dataType === "NUMBER" &&
    field.isIssueField === true &&
    f?.__typename === "IssueFieldNumber" &&
    f.id === c.node &&
    String(f.fullDatabaseId) === String(c.id) &&
    f.name === "Estimate Hours" &&
    f.dataType === "NUMBER" &&
    f.visibility === "ALL"
  );
}
export const validHours = (value) =>
  value === null ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1000);
export function projectHours(value, env) {
  const c = hoursContract(env);
  if (!c) return undefined;
  if (value === null) return null;
  const v = value?.issueFieldValue;
  return value?.__typename === "ProjectV2ItemIssueFieldValue" &&
    value.field?.id === c.project &&
    v?.__typename === "IssueFieldNumberValue" &&
    v.field?.id === c.node &&
    typeof v.value === "number" &&
    validHours(v.value)
    ? v.value
    : undefined;
}

export function hoursVisibility(field, env) {
  if (publicHours(field, env)) return "public";
  const c = hoursContract(env),
    f = field?.issueField;
  return c &&
    field?.id === c.project &&
    f?.id === c.node &&
    String(f.fullDatabaseId) === String(c.id) &&
    f.visibility === "ORG_ONLY"
    ? "not_public"
    : "unavailable";
}
