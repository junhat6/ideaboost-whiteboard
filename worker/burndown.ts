// Historical observations, never reconstructed from today's state or issue close dates.
export type BurnTask = {
  id: string;
  parent: string;
  estimate: number | null;
  status: string | null;
  complete: boolean;
  milestone: number;
};
export type BurnSource = {
  ok: true;
  scope: string;
  observedAt: string;
  milestones: { number: number; title: string; dueOn: string | null }[];
  tasks: BurnTask[];
};
type Summary = ReturnType<typeof summarizeBurn>;
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
  "get" | "put" | "list" | "delete" | "setAlarm"
>;
export const jstDay = (time: number) =>
  new Date(time + 9 * 3600000).toISOString().slice(0, 10);
export const nextJstDay = (time: number) =>
  Date.parse(jstDay(time) + "T00:10:00+09:00") + 86400000;
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
            Number.isFinite(Date.parse(m.dueOn)))),
    ) &&
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
        (t.estimate === null ||
          (typeof t.estimate === "number" &&
            Number.isFinite(t.estimate) &&
            t.estimate >= 0 &&
            t.estimate <= 1000)) &&
        (t.status === null || typeof t.status === "string") &&
        t.complete === (t.status === "完了") &&
        Number.isSafeInteger(t.milestone) &&
        v.milestones.some((m) => m.number === t.milestone),
    )
  );
}
export function summarizeBurn(tasks: BurnTask[]) {
  const active = tasks.filter((t) => t.status !== "見送り");
  return {
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
export class BurnHistory {
  private tail: Promise<unknown> = Promise.resolve();
  private flight: Promise<{
    source: BurnSource;
    records: Observation[];
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
  private async remove(keys: string[]) {
    for (let n = 0; n < keys.length; n += 128)
      await this.storage.delete(keys.slice(n, n + 128));
  }
  private async collect() {
    const response = await this.source();
    if (!response.ok) {
      if (response.status === 403) {
        const days = await this.storage.list<Observation>({ prefix: "day:" });
        for (const [dayKey, dayValue] of days) {
          const records = await this.storage.list<Observation>({
            prefix: `observation:${dayValue.day}:`,
          });
          await this.remove(
            [...records].flatMap(([key, v]) => [key, v.snapshotKey]),
          );
          await this.storage.delete(dayKey);
        }
        await this.storage.delete(["latest-signature", "latest-tasks"]);
      }
      const error = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        response.status === 403
          ? error.error === "estimate_hours_not_public"
            ? error.error
            : "scope_not_public"
          : "observation_unavailable",
      );
    }
    const source = await response.json();
    if (!validateBurnSource(source)) throw new Error("observation_incomplete");
    const time = this.now(),
      day = jstDay(time);
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
          summaries[m.number] = summarizeBurn(tasks);
          const oldMap = new Map(
            old.filter((t) => t.status !== "見送り").map((t) => [t.id, t]),
          );
          const newMap = new Map(
            tasks.filter((t) => t.status !== "見送り").map((t) => [t.id, t]),
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
    };
  }
  async fetch(request: Request) {
    const raw = new URL(request.url).searchParams.get("milestone");
    if (raw !== null && !/^[1-9]\d{0,8}$/.test(raw))
      return Response.json({ error: "invalid_milestone" }, { status: 400 });
    try {
      await this.storage.setAlarm(nextJstDay(this.now()));
      const { source, records, recordingLimited } = await this.collection();
      const future = source.milestones
        .filter((m) => m.dueOn && Date.parse(m.dueOn) >= this.now())
        .sort((a, b) => Date.parse(a.dueOn!) - Date.parse(b.dueOn!));
      const milestone =
        raw === null
          ? ((future[0] ?? source.milestones.at(-1))?.number ?? null)
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
      return Response.json({
        ok: true,
        observedAt: source.observedAt,
        milestones: source.milestones,
        milestone,
        current: summarizeBurn(filter(source.tasks)),
        observations: records
          .filter(
            (v) =>
              milestone !== null &&
              Object.hasOwn(v.summaries, String(milestone)),
          )
          .map((v) => ({
            at: v.observedAt,
            day: v.day,
            ...v.summaries[String(milestone)],
            changes: v.changes[String(milestone)],
          })),
        ideal: null,
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
    try {
      await this.collection();
    } finally {
      await this.storage.setAlarm(nextJstDay(this.now()));
    }
  }
}
