import { pathToFileURL } from "node:url";
import { productionBase } from "./deployment-check.mjs";

const validDay = (value) =>
  typeof value === "string" &&
  /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
const timestamp = (value) => {
  if (
    typeof value !== "string" ||
    !/^20\d{2}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Sprint 10 audit timestamp is invalid");
  return new Date(value).toISOString();
};
const count = (value) => Number.isSafeInteger(value) && value >= 0;
function summary(value) {
  const counts = [
    "estimated",
    "unestimated",
    "total",
    "cancelled",
    "excludedChildren",
  ];
  if (
    !value ||
    counts.some((key) => !count(value[key])) ||
    value.estimated + value.unestimated !== value.total ||
    value.total + value.cancelled > 500 ||
    !Number.isFinite(value.estimatedHours) ||
    !Number.isFinite(value.remainingHours) ||
    value.remainingHours < 0 ||
    value.estimatedHours < value.remainingHours ||
    value.estimatedHours > 500000
  )
    throw new Error("Sprint 10 audit summary is invalid");
  return {
    estimatedHours: value.estimatedHours,
    remainingHours: value.remainingHours,
    completedEstimatedHours: value.estimatedHours - value.remainingHours,
    ...Object.fromEntries(counts.map((key) => [key, value[key]])),
  };
}

// Normal public GET only: no credentials, redirects, retries, Issue writes or
// schedule writes. Explicit projections prevent Issue IDs/bodies leaking to logs.
export async function inspectSprintTen(base, fetcher = fetch) {
  const url = new URL("api/burndown?milestone=10", productionBase(base));
  let response;
  try {
    response = await fetcher(url, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("Sprint 10 history read failed (network or timeout)");
  }
  if (!response.ok)
    throw new Error(`Sprint 10 history read failed (HTTP ${response.status})`);
  const data = await response.json().catch(() => {
    throw new Error("Sprint 10 audit response is not JSON");
  });
  const days = data?.schedule?.schoolDays;
  if (
    data?.ok !== true ||
    data.milestone !== 10 ||
    !["live", "historical"].includes(data.display?.mode) ||
    !Array.isArray(days) ||
    days.length > 60 ||
    days.some((day, i) => !validDay(day) || (i > 0 && day <= days[i - 1])) ||
    !Array.isArray(data.observations) ||
    data.observations.length > 182 ||
    !Array.isArray(data.milestones)
  )
    throw new Error("Sprint 10 audit response is invalid");
  const milestone = data.milestones.find((item) => item.number === 10);
  if (!milestone) throw new Error("Sprint 10 audit milestone is unavailable");
  return {
    milestone: 10,
    observedAt: timestamp(data.observedAt),
    current: summary(data.current),
    display: {
      mode: data.display.mode,
      observedAt:
        data.display.observedAt === null
          ? null
          : timestamp(data.display.observedAt),
      summary:
        data.display.summary === null ? null : summary(data.display.summary),
      cutoff:
        data.display.cutoff === null ? null : timestamp(data.display.cutoff),
    },
    assignment: milestone.assignmentWindow
      ? {
          startAt: timestamp(milestone.assignmentWindow.startAt),
          endAt: timestamp(milestone.assignmentWindow.endAt),
        }
      : null,
    schoolDays: [...days],
    recordingLimited: data.recordingLimited === true,
    observations: data.observations.map((point) => {
      if (!validDay(point.day))
        throw new Error("Sprint 10 audit day is invalid");
      return { day: point.day, at: timestamp(point.at), ...summary(point) };
    }),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(
        await inspectSprintTen(process.env.PRODUCTION_BASE_URL),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
