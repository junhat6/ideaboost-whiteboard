const validDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
const validTimestamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value,
  ) &&
  validDate(value.slice(0, 10)) &&
  Number.isFinite(Date.parse(value));

export function validCatalogMilestone(value) {
  return (
    !!value &&
    Number.isSafeInteger(value.number) &&
    value.number > 0 &&
    typeof value.title === "string" &&
    (value.description === null || typeof value.description === "string") &&
    (value.dueOn === null || validTimestamp(value.dueOn)) &&
    ["OPEN", "CLOSED"].includes(value.state) &&
    (value.closedAt === null || validTimestamp(value.closedAt))
  );
}

// Mirror the repository's explicit v2 assignment policy, not a calendar guess.
// Unknown metadata, a missing due date, or a title mismatch cannot establish an end.
export function sprintAssignmentWindow(milestone) {
  const description = milestone.description;
  if (
    milestone.title !== `Sprint ${milestone.number}` ||
    typeof description !== "string" ||
    description.split("idea-boost-sprint:").length !== 2 ||
    !validTimestamp(milestone.dueOn)
  )
    return undefined;
  const matches = [
    ...description.matchAll(/<!--\s*idea-boost-sprint:v2\s*([\s\S]*?)-->/g),
  ];
  if (matches.length !== 1) return undefined;
  let period;
  try {
    period = JSON.parse(matches[0][1]);
  } catch {
    return undefined;
  }
  if (
    period?.schema_version !== 2 ||
    period.timezone !== "Asia/Tokyo" ||
    !validDate(period.assignment_start_date)
  )
    return undefined;
  const start = Date.parse(`${period.assignment_start_date}T00:00:00+09:00`),
    dueDate = new Date(Date.parse(milestone.dueOn) + 9 * 3600000)
      .toISOString()
      .slice(0, 10),
    end = Date.parse(`${dueDate}T00:00:00+09:00`);
  if (!(start < end)) return undefined;
  return {
    policy: "sprint-v2-exclusive-jst",
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
  };
}
