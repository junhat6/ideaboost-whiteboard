import { DurableObject } from "cloudflare:workers";
import { createHandler } from "../server/github.mjs";
import { BoardReader, withReadInvalidation } from "./reader";
import { MutationCoordinator } from "./coordinator";
import { BurnHistory } from "./burndown";
import { TeamNotesStore } from "./team-notes";
import type { Env } from "./index";
export { default } from "./index";
export class HistoryCoordinator extends DurableObject<Env> {
  private history: BurnHistory;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const handler = createHandler();
    this.history = new BurnHistory(ctx.storage, async () => {
      const response = await handler(
        new Request("https://internal/api/burndown", {
          headers: { "x-verified-user-id": "history-observer" },
        }),
        env,
      );
      return (
        response ??
        Response.json({ error: "observation_unavailable" }, { status: 503 })
      );
    });
  }
  fetch(request: Request) {
    return this.history.fetch(request);
  }
  alarm() {
    return this.history.alarm();
  }
}
export class IssueCoordinator extends DurableObject<Env> {
  private coordinator: MutationCoordinator;
  private reader: BoardReader;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const handler = createHandler();
    this.reader = new BoardReader(
      (request) => handler(request, env),
      async (request) => {
        const url = new URL(request.url);
        url.pathname = "/api/scope";
        url.search = "";
        return (await handler(new Request(url, request), env))!;
      },
    );
    this.coordinator = new MutationCoordinator(ctx.storage, (request) =>
      handler(request, env),
    );
  }
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === "/internal/read-invalidation" && request.method === "POST") {
      const value = await request.json<{ id: string; begin: boolean }>();
      if (
        typeof value.id !== "string" ||
        value.id.length > 80 ||
        typeof value.begin !== "boolean"
      )
        return new Response(null, { status: 400 });
      const accepted = this.reader.invalidate(value.id, value.begin);
      return new Response(null, { status: accepted ? 204 : 503 });
    }
    if (path === "/api/board" && request.method === "GET")
      return this.reader.fetch(request);
    // 付箋への Issue の結び付けの照合（ADR 019）。Worker の内部からだけ届く（外の経路は転送しない）。
    if (path === "/internal/note-issued" && request.method === "GET")
      return Response.json({ issued: await this.coordinator.issued() });
    const reader = this.env.MUTATIONS!.getByName(
      "engineer-first/idea-boost:board-reader",
    );
    const id = crypto.randomUUID();
    const invalidate = (begin: boolean) =>
      reader.fetch(
        new Request("https://internal/internal/read-invalidation", {
          method: "POST",
          body: JSON.stringify({ id, begin }),
        }),
      );
    return withReadInvalidation(
      () => this.coordinator.fetch(request),
      invalidate,
    );
  }
}
/** チームの付箋。ボード 1 枚につき 1 つ。GitHub には書かない。 */
export class TeamNotesCoordinator extends DurableObject<Env> {
  private store: TeamNotesStore;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new TeamNotesStore(ctx.storage);
  }
  fetch(request: Request) {
    return this.store.fetch(request);
  }
}
