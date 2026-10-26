import { DurableObject } from "cloudflare:workers";
import { createHandler } from "../server/github.mjs";
import { BoardReader, withReadInvalidation } from "./reader";
import { MutationCoordinator } from "./coordinator";
import type { Env } from "./index";
export { default } from "./index";
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
