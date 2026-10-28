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
  const window = currentSprintAssignmentWindow(milestone);
  return window?.endAt === null ? undefined : window;
}

// Current assignment also allows the bot's explicit unbounded end (due=null).
// History still needs a finite cutoff, so it uses sprintAssignmentWindow above.
export function currentSprintAssignmentWindow(milestone) {
  const description = milestone.description;
  if (
    milestone.title !== `Sprint ${milestone.number}` ||
    typeof description !== "string" ||
    description.split("idea-boost-sprint:").length !== 2 ||
    (milestone.dueOn !== null && !validTimestamp(milestone.dueOn))
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
  const start = Date.parse(`${period.assignment_start_date}T00:00:00+09:00`);
  let end = Infinity;
  if (milestone.dueOn !== null) {
    const dueDate = new Date(Date.parse(milestone.dueOn) + 9 * 3600000)
      .toISOString()
      .slice(0, 10);
    end = Date.parse(`${dueDate}T00:00:00+09:00`);
  }
  if (!(start < end)) return undefined;
  return {
    policy: "sprint-v2-exclusive-jst",
    startAt: new Date(start).toISOString(),
    endAt: end === Infinity ? null : new Date(end).toISOString(),
  };
}

// The catalog reader supplies validated rows and marks only explicit assignment
// metadata. Legacy/plain milestones do not claim a period; malformed marked
// metadata does, so it cannot safely be ignored when choosing a current sprint.
export function currentSprintSelection(milestones, now = Date.now()) {
  const unavailable = { currentSprint: null, status: "unavailable" };
  if (!Number.isFinite(now)) return unavailable;
  const managed = milestones.filter((m) => m.hasAssignmentMetadata);
  if (managed.some((m) => !m.assignmentWindow)) return unavailable;
  const active = managed.filter(
    (m) =>
      Date.parse(m.assignmentWindow.startAt) <= now &&
      (m.assignmentWindow.endAt === null ||
        now < Date.parse(m.assignmentWindow.endAt)),
  );
  if (active.length > 1) return unavailable;
  if (!active.length || active[0].state !== "OPEN")
    return { currentSprint: null, status: "none" };
  const current = active[0];
  return {
    currentSprint: {
      number: current.number,
      title: current.title,
      ...current.assignmentWindow,
    },
    status: "current",
  };
}
