import { DurableObject } from "cloudflare:workers";
import { createHandler } from "../server/github.mjs";
import { MutationCoordinator } from "./coordinator";
import type { Env } from "./index";
export { default } from "./index";
export class IssueCoordinator extends DurableObject<Env> {
  private coordinator: MutationCoordinator;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const handler = createHandler();
    this.coordinator = new MutationCoordinator(ctx.storage, (request) =>
      handler(request, env),
    );
  }
  async fetch(request: Request) {
    return this.coordinator.fetch(request);
  }
}
