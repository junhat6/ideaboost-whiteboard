// 保存観測は不変。表示時だけ最新の対象・見積で投影し、完了日時は推測しない。
export type BurnTask = {
  id: string;
  parent: string;
  pbi?: string;
  estimate: number | null;
  status: string | null;
  complete: boolean;
  state?: "OPEN" | "CLOSED";
  stateReason?: "COMPLETED" | "NOT_PLANNED" | "REOPENED" | "DUPLICATE" | null;
  milestone: number;
};
export type BurnSource = {
  ok: true;
  scope: string;
  observedAt: string;
  milestones: {
    number: number;
    title: string;
    dueOn: string | null;
    assignmentWindow?: { policy: string; startAt: string; endAt: string };
  }[];
  tasks: BurnTask[];
  excludedChildren?: { milestone: number; count: number }[];
};
export type SchoolSchedule = { schoolDays: string[]; revision: string };
const sprint9Days = [
  "2026-10-21",
  "2026-10-22",
  "2026-10-23",
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
];
export function validSchoolDays(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 60 &&
    value.every(
      (day, i) =>
        typeof day === "string" &&
        /^20\d{2}-\d{2}-\d{2}$/.test(day) &&
        Number.isFinite(Date.parse(day + "T00:00:00Z")) &&
        new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day &&
        (i === 0 || value[i - 1] < day),
    ) &&
    (value.length < 2 ||
      Date.parse(value.at(-1)!) - Date.parse(value[0]) <= 180 * 86400000)
  );
}

export const cancelledBurnTask = (t: BurnTask) =>
  t.status === "見送り" ||
  (t.state === "CLOSED" &&
    ["NOT_PLANNED", "DUPLICATE"].includes(t.stateReason ?? ""));
export const completedBurnTask = (t: BurnTask) =>
  !cancelledBurnTask(t) &&
  (t.status === "完了" ||
    (t.state === "CLOSED" && t.stateReason === "COMPLETED"));
type Summary = ReturnType<typeof summarizeBurn>;
type EndingBoundary = { cutoff: string; policy: string };
type Observation = {
  day: string;
  observedAt: string;
  scope: string;
  snapshotKey: string;
  summaries: Record<string, Summary>;
  changes: Record<
    string,
    { added: number; removed: number; reestimated: number; reopened: number }
  >;
};
type Storage = Pick<
  DurableObjectStorage,
  "get" | "put" | "list" | "delete" | "getAlarm" | "setAlarm" | "transaction"
>;
type AlarmRetry = { day: string; attempts: number };
const alarmRetryDelays = [60000, 300000, 900000];
const transientSourceStatuses = [429, 500, 502, 503, 504];
class ObservationSourceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code?: string,
    readonly upstreamStatus?: number,
  ) {
    super(message);
  }
  get retryable() {
    if (
      [
        "scope_not_public",
        "estimate_hours_not_public",
        "observation_incomplete",
        "invalid_private_key",
        "estimate_hours_unavailable",
      ].includes(this.code ?? this.message) ||
      (this.status !== null && !transientSourceStatuses.includes(this.status))
    )
      return false;
    // GitHub's API boundary wraps all upstream HTTP failures in 502. Do not
    // mistake an upstream 401 or a malformed GraphQL response for an outage.
    if (this.code === "github_request_failed")
      return transientSourceStatuses.includes(this.upstreamStatus ?? 0);
    if (this.code?.startsWith("github_"))
      return this.code === "github_network_error";
    return true;
  }
}
export const jstDay = (time: number) =>
  new Date(time + 9 * 3600000).toISOString().slice(0, 10);
export const nextJstDay = (time: number) => {
  const today = Date.parse(jstDay(time) + "T00:10:00+09:00");
  return today > time ? today : today + 86400000;
};
const assignmentPolicy = "sprint-v2-exclusive-jst";
function assignmentWindow(milestone: BurnSource["milestones"][number]) {
  const window = milestone.assignmentWindow;
  if (!window || window.policy !== assignmentPolicy) return null;
  const start = Date.parse(window.startAt),
    end = Date.parse(window.endAt);
  // Only the formal, exclusive JST-midnight contract supports the daily index.
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    (start + 9 * 3600000) % 86400000 !== 0 ||
    (end + 9 * 3600000) % 86400000 !== 0
  )
    return null;
  return { start, end, policy: window.policy };
}
export function validateBurnSource(value: unknown): value is BurnSource {
  const v = value as BurnSource;
  return (
    !!v &&
    v.ok === true &&
    typeof v.scope === "string" &&
    v.scope.length < 2000 &&
    typeof v.observedAt === "string" &&
    Number.isFinite(Date.parse(v.observedAt)) &&
    Array.isArray(v.milestones) &&
    v.milestones.length <= 100 &&
    v.milestones.every(
      (m) =>
        Number.isSafeInteger(m.number) &&
        m.number > 0 &&
        typeof m.title === "string" &&
        (m.dueOn === null ||
          (typeof m.dueOn === "string" &&
            Number.isFinite(Date.parse(m.dueOn)))) &&
        (m.assignmentWindow === undefined ||
          (!!m.assignmentWindow &&
            typeof m.assignmentWindow.policy === "string" &&
            m.assignmentWindow.policy.length <= 100 &&
            typeof m.assignmentWindow.startAt === "string" &&
            Number.isFinite(Date.parse(m.assignmentWindow.startAt)) &&
            typeof m.assignmentWindow.endAt === "string" &&
            Number.isFinite(Date.parse(m.assignmentWindow.endAt)) &&
            Date.parse(m.assignmentWindow.startAt) <
              Date.parse(m.assignmentWindow.endAt))),
    ) &&
    (v.excludedChildren === undefined ||
      (Array.isArray(v.excludedChildren) &&
        v.excludedChildren.length <= 500 &&
        v.excludedChildren.every(
          (e) =>
            Number.isSafeInteger(e.count) &&
            e.count >= 0 &&
            v.milestones.some((m) => m.number === e.milestone),
        ))) &&
    Array.isArray(v.tasks) &&
    v.tasks.length <= 500 &&
    new TextEncoder().encode(JSON.stringify(v)).length < 100000 &&
    new Set(v.tasks.map((t) => t.id)).size === v.tasks.length &&
    v.tasks.every(
      (t) =>
        typeof t.id === "string" &&
        t.id.length < 100 &&
        typeof t.parent === "string" &&
        t.parent.length < 100 &&
        (t.pbi === undefined ||
          (typeof t.pbi === "string" && t.pbi.length < 100)) &&
        (t.estimate === null ||
          (typeof t.estimate === "number" &&
            Number.isFinite(t.estimate) &&
            t.estimate >= 0 &&
            t.estimate <= 1000)) &&
        (t.status === null || typeof t.status === "string") &&
        (t.state === undefined || ["OPEN", "CLOSED"].includes(t.state)) &&
        (t.stateReason === undefined ||
          t.stateReason === null ||
          ["COMPLETED", "NOT_PLANNED", "REOPENED", "DUPLICATE"].includes(
            t.stateReason,
          )) &&
        t.complete === completedBurnTask(t) &&
        Number.isSafeInteger(t.milestone) &&
        v.milestones.some((m) => m.number === t.milestone),
    )
  );
}
export function summarizeBurn(tasks: BurnTask[], excludedChildren = 0) {
  const active = tasks.filter((t) => !cancelledBurnTask(t));
  return {
    excludedChildren,
    remainingHours: active.reduce(
      (sum, t) => sum + (!t.complete && t.estimate !== null ? t.estimate : 0),
      0,
    ),
    estimatedHours: active.reduce((sum, t) => sum + (t.estimate ?? 0), 0),
    unestimated: active.filter((t) => t.estimate === null).length,
    estimated: active.filter((t) => t.estimate !== null).length,
    total: active.length,
    cancelled: tasks.length - active.length,
  };
}
// 古い snapshot も同じ正本判定を検証する。不完全な記録を空の集合にしない。
function snapshotTasks(value: unknown): BurnTask[] | null {
  if (
    !Array.isArray(value) ||
    value.some((task) => !task || typeof task !== "object")
  )
    return null;
  const milestones = [...new Set(value.map((task) => task.milestone))].map(
    (number) => ({ number, title: "snapshot", dueOn: null }),
  );
  const candidate = {
    ok: true,
    scope: "snapshot",
    observedAt: "2000-01-01T00:00:00Z",
    milestones,
    tasks: value,
  };
  return validateBurnSource(candidate) ? candidate.tasks : null;
}

// 配列の形だけでは切り詰められたsnapshotを検出できない。保存summaryとも照合する。
function observationTasks(
  value: unknown,
  record: Observation,
): BurnTask[] | null {
  const tasks = snapshotTasks(value);
  if (
    tasks === null ||
    tasks.some(
      (task) => !Object.hasOwn(record.summaries, String(task.milestone)),
    )
  )
    return null;
  const fields = [
    "remainingHours",
    "estimatedHours",
    "unestimated",
    "estimated",
    "total",
    "cancelled",
  ] as const;
  for (const [milestone, expected] of Object.entries(record.summaries)) {
    const actual = summarizeBurn(
      tasks.filter((task) => task.milestone === Number(milestone)),
    );
    if (!expected || fields.some((field) => actual[field] !== expected[field]))
      return null;
  }
  return tasks;
}

export function rebaseBurn(basis: BurnTask[] | null, snapshot: unknown) {
  const unknown = (reason: string, unknownTasks: number | null = null) => ({
    remainingHours: null,
    unknownTasks,
    assumedIncompleteTasks: null,
    reason,
  });
  if (basis === null) return unknown("basis_unavailable");
  const past = snapshotTasks(snapshot);
  if (past === null) return unknown("snapshot_unavailable");
  const byId = new Map(past.map((task) => [task.id, task]));
  const active = basis.filter((task) => !cancelledBurnTask(task));
  // 0h と未見積は数値寄与しない。未見積件数は基準 summary に残す。
  const weighted = active.filter(
    (task) => task.estimate !== null && task.estimate > 0,
  );
  // 利用者承認の遡及projection: 有効な記録にない現在対象は未完了として置く。
  // snapshot全体の欠測/不完全とは別で、作成日や実際の追加日を推測しない。
  const missing = active.filter((task) => !byId.has(task.id)).length;
  return {
    remainingHours: weighted.reduce(
      (sum, task) => sum + (byId.get(task.id)?.complete ? 0 : task.estimate!),
      0,
    ),
    unknownTasks: 0,
    assumedIncompleteTasks: missing,
    reason: null,
  };
}

export class BurnHistory {
  private tail: Promise<unknown> = Promise.resolve();
  private flight: Promise<{
    source: BurnSource;
    records: Observation[];
    boundaries: Map<number, EndingBoundary>;
    recordingLimited: boolean;
  }> | null = null;
  private collection() {
    if (!this.flight) {
      const pending = this.enqueue(() => this.collect());
      this.flight = pending;
      void pending
        .finally(() => {
          if (this.flight === pending) this.flight = null;
        })
        .catch(() => {});
    }
    return this.flight;
  }
  constructor(
    private storage: Storage,
    private source: () => Promise<Response>,
    private now = Date.now,
  ) {}
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.then(run, run);
    this.tail = next.catch(() => {});
    return next;
  }
  private planAlarm(retry = false) {
    // Serialize GET bootstrap and alarm completion. Network collection stays outside
    // this transaction, and a later GET must never postpone an earlier retry.
    return this.enqueue(() =>
      this.storage.transaction(async (tx) => {
        const time = this.now(),
          day = jstDay(time),
          daily = nextJstDay(time);
        let next = daily,
          attempts = alarmRetryDelays.length;
        if (retry) {
          const previous = await tx.get<AlarmRetry>("alarm-retry");
          if (previous?.day !== day) attempts = 0;
          else if (
            Number.isSafeInteger(previous.attempts) &&
            previous.attempts >= 0 &&
            previous.attempts <= alarmRetryDelays.length
          )
            attempts = previous.attempts;
          if (attempts < alarmRetryDelays.length)
            next = Math.min(next, time + alarmRetryDelays[attempts]);
        }
        const current = await tx.getAlarm();
        if (current === null || next < current) {
          if (next < daily)
            await tx.put("alarm-retry", { day, attempts: attempts + 1 });
          await tx.setAlarm(next);
        }
      }),
    );
  }
  private async remove(keys: string[]) {
    for (let n = 0; n < keys.length; n += 128)
      await this.storage.delete(keys.slice(n, n + 128));
  }
  private async endingBoundaries(source: BurnSource, time: number) {
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(source.scope),
        ),
      ),
    )
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const prefix = `sprint-boundary:${hash}:`,
      stored = await this.storage.list<EndingBoundary>({ prefix }),
      boundaries = new Map<number, EndingBoundary>();
    const ending = source.milestones.filter((milestone) => {
      const previous = stored.get(prefix + milestone.number);
      if (previous) {
        if (
          previous.policy !== assignmentPolicy ||
          !Number.isFinite(Date.parse(previous.cutoff))
        )
          throw new Error("observation_incomplete");
        boundaries.set(milestone.number, previous);
        return false;
      }
      const window = assignmentWindow(milestone);
      return window !== null && window.end <= time;
    });
    if (ending.length)
      await this.storage.transaction(async (tx) => {
        for (const milestone of ending) {
          const key = prefix + milestone.number,
            previous = await tx.get<EndingBoundary>(key);
          if (previous) {
            boundaries.set(milestone.number, previous);
            continue;
          }
          const window = assignmentWindow(milestone)!;
          const boundary = {
            cutoff: new Date(window.end).toISOString(),
            policy: window.policy,
          };
          // Pin only the ended boundary, never a summary, active window or source data.
          // Kept metadata cannot resurrect observations after their normal retention expiry.
          await tx.put(key, boundary);
          boundaries.set(milestone.number, boundary);
        }
      });
    return boundaries;
  }
  private async collect() {
    let response: Response;
    try {
      response = await this.source();
    } catch (error) {
      // Only rejection of the source call is transport-retryable; parsing,
      // validation and storage failures below do not spend short-retry budget.
      throw new ObservationSourceError(
        error instanceof Error ? error.message : "observation_unavailable",
        null,
      );
    }
    if (!response.ok) {
      // Loss of visibility blocks disclosure; it does not authorize deleting history.
      const error = (await response.json().catch(() => ({}))) as {
        error?: unknown;
        upstreamStatus?: unknown;
      } | null;
      const code = typeof error?.error === "string" ? error.error : undefined;
      throw new ObservationSourceError(
        response.status === 403
          ? code === "estimate_hours_not_public"
            ? code
            : "scope_not_public"
          : "observation_unavailable",
        response.status,
        code,
        typeof error?.upstreamStatus === "number"
          ? error.upstreamStatus
          : undefined,
      );
    }
    const source = await response.json();
    if (!validateBurnSource(source)) throw new Error("observation_incomplete");
    const time = this.now(),
      // Source time owns the observation's JST day and its daily write budget.
      // Persistence can cross midnight; indexing it by storage time would let
      // tomorrow's point overwrite the final pre-cutoff day index.
      day = jstDay(Date.parse(source.observedAt));
    const canonical = {
      ...source,
      tasks: [...source.tasks].sort((a, b) => a.id.localeCompare(b.id)),
    };
    const signature = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(
            JSON.stringify([
              day,
              canonical.scope,
              canonical.tasks,
              canonical.milestones,
              canonical.excludedChildren ?? [],
            ]),
          ),
        ),
      ),
    )
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    let recordingLimited = false;
    if ((await this.storage.get("latest-signature")) !== signature) {
      const today = await this.storage.list({ prefix: `observation:${day}:` });
      if (today.size < 96) {
        const previous =
          (await this.storage.get<BurnTask[]>("latest-tasks")) || [];
        const summaries: Observation["summaries"] = {},
          changes: Observation["changes"] = {};
        for (const m of canonical.milestones) {
          const tasks = canonical.tasks.filter((t) => t.milestone === m.number),
            old = previous.filter((t) => t.milestone === m.number);
          summaries[m.number] = summarizeBurn(
            tasks,
            (canonical.excludedChildren || [])
              .filter((e) => e.milestone === m.number)
              .reduce((n, e) => n + e.count, 0),
          );
          const oldMap = new Map(
            old.filter((t) => !cancelledBurnTask(t)).map((t) => [t.id, t]),
          );
          const newMap = new Map(
            tasks.filter((t) => !cancelledBurnTask(t)).map((t) => [t.id, t]),
          );
          changes[m.number] = {
            added: [...newMap.keys()].filter((id) => !oldMap.has(id)).length,
            removed: [...oldMap.keys()].filter((id) => !newMap.has(id)).length,
            reestimated: tasks.filter(
              (t) =>
                oldMap.has(t.id) && oldMap.get(t.id)!.estimate !== t.estimate,
            ).length,
            reopened: tasks.filter(
              (t) => oldMap.get(t.id)?.complete && !t.complete,
            ).length,
          };
        }
        const key = `observation:${day}:${String(time).padStart(15, "0")}`,
          snapshotKey = `tasks:${key}`;
        // One atomic multi-key write. A retry cannot commit only a signature or lose the snapshot.
        const observation = {
          day,
          observedAt: canonical.observedAt,
          scope: canonical.scope,
          snapshotKey,
          summaries,
          changes,
        };
        await this.storage.put({
          [key]: observation,
          [`day:${day}`]: observation,
          [snapshotKey]: canonical.tasks,
          "latest-signature": signature,
          "latest-tasks": canonical.tasks,
        });
      } else recordingLimited = true;
    }
    const records = await this.storage.list<Observation>({
      prefix: "day:",
    });
    const oldest = jstDay(time - 180 * 86400000);
    for (const [dayKey, value] of records) {
      if (value.day >= oldest) continue;
      const expired = await this.storage.list<Observation>({
        prefix: `observation:${value.day}:`,
      });
      await this.remove([...expired].flatMap(([k, v]) => [k, v.snapshotKey]));
      await this.storage.delete(dayKey);
    }
    return {
      source,
      recordingLimited,
      records: [...records.values()].filter((v) => v.day >= oldest),
      boundaries: await this.endingBoundaries(source, time),
    };
  }
  private async schedule(milestone: number | null): Promise<SchoolSchedule> {
    if (milestone === null) return { schoolDays: [], revision: "0" };
    const key = `school-days:${milestone}`;
    const stored = await this.storage.get<SchoolSchedule>(key);
    if (stored) return stored;
    const initial = {
      schoolDays: milestone === 9 ? sprint9Days : [],
      revision: "0",
    };
    // Sprint 9's six days were explicitly supplied by the owner, not inferred.
    // The versioned default persists with the deployment; explicit overrides live in storage.
    return initial;
  }
  private async saveSchedule(request: Request, milestone: number) {
    if (request.headers.get("Origin") !== new URL(request.url).origin)
      return Response.json({ error: "origin_mismatch" }, { status: 403 });
    const reader = request.body?.getReader();
    if (!reader)
      return Response.json({ error: "invalid_schedule" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        return Response.json({ error: "invalid_schedule" }, { status: 400 });
      }
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    const body = new TextDecoder().decode(buffer);
    let v: {
      schoolDays: string[];
      expectedRevision: string;
      requestId: string;
    };
    try {
      v = JSON.parse(body);
    } catch {
      return Response.json({ error: "invalid_schedule" }, { status: 400 });
    }
    if (
      !v ||
      Object.keys(v).some(
        (k) => !["schoolDays", "expectedRevision", "requestId"].includes(k),
      ) ||
      !validSchoolDays(v.schoolDays) ||
      typeof v.expectedRevision !== "string" ||
      v.expectedRevision.length > 64 ||
      typeof v.requestId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(v.requestId)
    )
      return Response.json({ error: "invalid_schedule" }, { status: 400 });
    return this.enqueue(async () => {
      // A settings write verifies current public scope without joining an older collection.
      const { source } = await this.collect();
      if (!source.milestones.some((m) => m.number === milestone))
        return Response.json({ error: "sprint_unavailable" }, { status: 404 });
      const key = `school-days:${milestone}`;
      const current = await this.schedule(milestone);
      const receipt = await this.storage.get<{
        id: string;
        input: string;
        schedule: SchoolSchedule;
      }>(`school-receipt:${milestone}`);
      const input = JSON.stringify([v.expectedRevision, v.schoolDays]);
      if (receipt?.id === v.requestId)
        return receipt.input === input
          ? Response.json({ ok: true, schedule: receipt.schedule })
          : Response.json({ error: "request_id_reused" }, { status: 409 });
      if (current.revision !== v.expectedRevision)
        return Response.json({ error: "schedule_conflict" }, { status: 409 });
      const schedule = {
        schoolDays: v.schoolDays,
        revision: crypto.randomUUID(),
      };
      await this.storage.put({
        [key]: schedule,
        [`school-receipt:${milestone}`]: { id: v.requestId, input, schedule },
      });
      return Response.json({ ok: true, schedule });
    });
  }
  async fetch(request: Request) {
    const raw = new URL(request.url).searchParams.get("milestone");
    if (raw !== null && !/^[1-9]\d{0,8}$/.test(raw))
      return Response.json({ error: "invalid_milestone" }, { status: 400 });
    try {
      if (request.method === "POST") {
        if (
          new URL(request.url).pathname !== "/api/burndown/schedule" ||
          raw === null
        )
          return Response.json({ error: "invalid_schedule" }, { status: 400 });
        return await this.saveSchedule(request, Number(raw));
      }
      if (request.method !== "GET") return new Response(null, { status: 405 });
      await this.planAlarm();
      const { source, records, recordingLimited, boundaries } =
        await this.collection();
      const active = source.milestones
        .filter((m) => {
          const window = assignmentWindow(m);
          return (
            !boundaries.has(m.number) &&
            window &&
            window.start <= this.now() &&
            this.now() < window.end
          );
        })
        .sort(
          (a, b) =>
            Date.parse(a.assignmentWindow!.endAt) -
            Date.parse(b.assignmentWindow!.endAt),
        );
      const future = source.milestones
        .filter(
          (m) =>
            !boundaries.has(m.number) &&
            m.dueOn &&
            Date.parse(m.dueOn) >= this.now(),
        )
        .sort((a, b) => Date.parse(a.dueOn!) - Date.parse(b.dueOn!));
      const milestone =
        raw === null
          ? ((active[0] ?? future[0] ?? source.milestones.at(-1))?.number ??
            null)
          : Number(raw);
      if (
        milestone !== null &&
        !source.milestones.some((m) => m.number === milestone)
      )
        return Response.json({ error: "sprint_unavailable" }, { status: 404 });
      const filter = (tasks: BurnTask[]) =>
        milestone === null
          ? tasks
          : tasks.filter((t) => t.milestone === milestone);
      const current = summarizeBurn(
          filter(source.tasks),
          (source.excludedChildren || [])
            .filter((e) => milestone === null || e.milestone === milestone)
            .reduce((n, e) => n + e.count, 0),
        ),
        boundary = milestone === null ? undefined : boundaries.get(milestone),
        visibleRecords = records.filter(
          (v) =>
            milestone !== null &&
            v.scope === source.scope &&
            Object.hasOwn(v.summaries, String(milestone)) &&
            (!boundary ||
              Date.parse(v.observedAt) < Date.parse(boundary.cutoff)),
        ),
        last = boundary
          ? visibleRecords.reduce<Observation | undefined>(
              (latest, record) =>
                !latest ||
                Date.parse(record.observedAt) > Date.parse(latest.observedAt)
                  ? record
                  : latest,
              undefined,
            )
          : undefined;
      // 一度に全 snapshot を展開せず、日次 index の参照先だけを順次読む。
      // 終了済み Sprint は最後の保存 scope を基準にして繰越後の0へ潰さない。
      const basis = boundary
        ? last
          ? observationTasks(await this.storage.get(last.snapshotKey), last)
          : null
        : source.tasks;
      const basisTasks = basis === null ? null : filter(basis);
      const projections = new Map<Observation, ReturnType<typeof rebaseBurn>>();
      const keys = [
        ...new Set(visibleRecords.map((record) => record.snapshotKey)),
      ];
      // Storage get の上限128より小さい32件単位で読み、raw task配列を保持しない。
      for (let offset = 0; offset < keys.length; offset += 32) {
        const batch = keys.slice(offset, offset + 32);
        const snapshots = await this.storage.get<unknown>(batch);
        for (const record of visibleRecords.filter((record) =>
          batch.includes(record.snapshotKey),
        ))
          projections.set(
            record,
            rebaseBurn(
              basisTasks,
              observationTasks(snapshots.get(record.snapshotKey), record),
            ),
          );
      }
      const rebasedObservations = visibleRecords.map((record) => ({
        at: record.observedAt,
        day: record.day,
        ...projections.get(record)!,
      }));
      return Response.json({
        ok: true,
        observedAt: source.observedAt,
        milestones: source.milestones,
        milestone,
        current,
        display: boundary
          ? {
              mode: "historical",
              summary: last?.summaries[String(milestone)] ?? null,
              observedAt: last?.observedAt ?? null,
              cutoff: boundary.cutoff,
              policy: boundary.policy,
            }
          : {
              mode: "live",
              summary: current,
              observedAt: source.observedAt,
              cutoff: null,
              policy: null,
            },
        observations: visibleRecords.map((v) => ({
          at: v.observedAt,
          day: v.day,
          ...v.summaries[String(milestone)],
          changes: v.changes[String(milestone)],
        })),
        rebase: {
          policy: "latest-scope-observed-completion-v1",
          basis: boundary ? "final-observation" : "current",
          observations: rebasedObservations,
        },
        scope: source.scope,
        schedule: await this.schedule(milestone),
        timezone: "Asia/Tokyo",
        retentionDays: 180,
        recordingLimited,
      });
    } catch (error) {
      return Response.json(
        { error: (error as Error).message },
        {
          status: ["scope_not_public", "estimate_hours_not_public"].includes(
            (error as Error).message,
          )
            ? 403
            : 503,
        },
      );
    }
  }
  async alarm() {
    let retry = false;
    try {
      await this.collection();
    } catch (error) {
      retry = error instanceof ObservationSourceError && error.retryable;
      throw error;
    } finally {
      // Success/GET do not replenish today's durable budget. A new or already
      // queued alarm supersedes runtime retries, while the original error remains visible.
      await this.planAlarm(retry);
    }
  }
}
