// The Project field is only a reference to the canonical public organization Issue field.
export const POINT_META = `pointsField:field(name:"Story points") { __typename ... on ProjectV2Field { id name dataType isIssueField issueField { __typename ... on IssueFieldNumber { id fullDatabaseId name dataType visibility } } } }`;
export const POINT_VALUE = `pointsValue:fieldValueByName(name:"Story points") { __typename ... on ProjectV2ItemIssueFieldValue { field { ... on ProjectV2Field { id } } issueFieldValue { __typename ... on IssueFieldNumberValue { value field { ... on IssueFieldNumber { id } } } } } }`;
export function publicProjectPoints(field) {
  const issue = field?.issueField;
  return (
    field?.__typename === "ProjectV2Field" &&
    field.id === "PVTF_lADOEYcVLM4Bb8yFzhnWjbg" &&
    field.name === "Story points" &&
    field.dataType === "NUMBER" &&
    field.isIssueField === true &&
    issue?.__typename === "IssueFieldNumber" &&
    issue.id === "IFN_kgDOAuy0Fw" &&
    String(issue.fullDatabaseId) === "49067031" &&
    issue.name === "Story points" &&
    issue.dataType === "NUMBER" &&
    issue.visibility === "ALL"
  );
}
export function projectPoint(value) {
  if (value === null) return null;
  if (
    value?.__typename !== "ProjectV2ItemIssueFieldValue" ||
    value.field?.id !== "PVTF_lADOEYcVLM4Bb8yFzhnWjbg"
  )
    return undefined;
  const v = value.issueFieldValue;
  return v?.__typename === "IssueFieldNumberValue" &&
    v.field?.id === "IFN_kgDOAuy0Fw" &&
    typeof v.value === "number" &&
    Number.isFinite(v.value)
    ? v.value
    : undefined;
}
