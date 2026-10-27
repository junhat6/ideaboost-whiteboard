import test from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../worker/index.ts";
import { createHandler } from "../server/github.mjs";
import { fixture, env as githubEnv, req, patch } from "./github-fixture.mjs";
const path = "/b/" + "a".repeat(48);
const env = {
  AUTH_MODE: "public-temporary",
  APP_ORIGIN: "https://board.example",
  PUBLIC_PATH: path,
  ASSETS: {
    fetch: async (r: Request) => new Response(new URL(r.url).pathname),
  },
  PUBLIC_LIMITER: { limit: async () => ({ success: true }) },
} as any;
const request = (suffix = "/", method = "GET", origin = env.APP_ORIGIN) =>
  new Request(env.APP_ORIGIN + path + suffix, {
    method,
    headers: { Origin: origin, "x-verified-user-id": "spoofed" },
  });
test("public mode gates exact path and host, strips prefix, marks anonymous and noindex", async () => {
  const worker = createWorker(
    async () => {
      throw Error("must not require Access");
    },
    async (r) =>
      r.url.includes("/api/")
        ? Response.json({
            path: new URL(r.url).pathname,
            user: r.headers.get("x-verified-user-id"),
          })
        : null,
  );
  assert.equal(
    (await worker.fetch(new Request(env.APP_ORIGIN + "/"), env)).status,
    404,
  );
  assert.equal(
    (await worker.fetch(new Request("https://other.example" + path + "/"), env))
      .status,
    403,
  );
  assert.equal((await worker.fetch(request(""), env)).status, 308);
  assert.equal(
    await (await worker.fetch(request("/app.js"), env)).text(),
    "/app.js",
  );
  const r = await worker.fetch(request("/api/board"), env);
  assert.deepEqual(await r.json(), {
    path: "/api/board",
    user: "public-anonymous",
  });
  assert.match(r.headers.get("X-Robots-Tag")!, /noindex/);
  assert.equal(r.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(
    (
      await worker.fetch(request("/api/board"), {
        ...env,
        PUBLIC_LIMITER: undefined,
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await worker.fetch(request("/api/board"), {
        ...env,
        PUBLIC_LIMITER: { limit: async () => ({ success: false }) },
      })
    ).status,
    429,
  );
});
test("public mutation still checks Origin and uses shared coordinator, never direct API", async () => {
  let calls = 0;
  const worker = createWorker(undefined, async () => {
    throw Error("bypassed");
  });
  const bindings = {
    ...env,
    MUTATIONS: {
      getByName: (name: string) => {
        assert.equal(name, "engineer-first/idea-boost:2");
        return {
          fetch: async (r: Request) => {
            calls++;
            assert.equal(new URL(r.url).pathname, "/api/issues/2");
            return Response.json({ ok: true });
          },
        };
      },
    },
  };
  assert.equal(
    (
      await worker.fetch(
        request("/api/issues/2", "POST", "https://evil.example"),
        bindings,
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await worker.fetch(request("/api/issues/2", "POST"), bindings)).status,
    200,
  );
  assert.equal(calls, 1);
});
test("public data rejects private repo/project and privacy change during board read; writes reject too", async () => {
  for (const viewFilter of ["milestone:Sprint", "type:PBI"])
    for (const mode of [
      "public",
      "private-repo",
      "private-project",
      "changed",
    ]) {
      const f = fixture({ viewFilter });
      let checks = 0;
      const handler = createHandler({
        fetch: async (url: any, opt: any) => {
          const body = opt.body ? JSON.parse(opt.body) : {};
          if (
            body.query?.includes("PublicScope") ||
            body.query?.includes("BoardBootstrap") ||
            body.query?.includes("MutationContext")
          ) {
            checks++;
            const original =
              body.query.includes("BoardBootstrap") ||
              body.query.includes("MutationContext")
                ? await (await f.fetch(url, opt)).json()
                : { data: { organization: { projectV2: {} } } };
            return Response.json({
              data: {
                repository: {
                  ...original.data.repository,
                  isPrivate: mode === "private-repo",
                },
                organization: {
                  projectV2: {
                    ...original.data.organization.projectV2,
                    public:
                      mode !== "private-project" &&
                      !(mode === "changed" && checks > 1),
                  },
                },
              },
            });
          }
          return f.fetch(url, opt);
        },
      });
      const e = { ...githubEnv, AUTH_MODE: "public-temporary" };
      const r = await handler(req("/api/board"), e);
      assert.equal(r!.status, mode === "public" ? 200 : 403, mode);
      if (mode !== "public")
        assert.equal((await r!.json()).error, "scope_not_public");
      if (mode === "private-repo" || mode === "private-project") {
        assert.equal(
          (await handler(req("/api/issues/2", patch({ title: "No" })), e))!
            .status,
          403,
        );
        assert.equal(
          f.calls.filter((c: any) => c.method === "PATCH").length,
          0,
        );
      }
    }
});

test("authorized board reads use the separate shared reader, after host/path/rate checks", async () => {
  let calls = 0;
  const worker = createWorker(undefined, async () => {
    throw Error("must use shared reader");
  });
  const bindings = {
    ...env,
    MUTATIONS: {
      getByName: (name: string) => {
        assert.equal(name, "engineer-first/idea-boost:board-reader");
        return {
          fetch: async (r: Request) => {
            calls++;
            assert.equal(
              r.headers.get("x-verified-user-id"),
              "public-anonymous",
            );
            return Response.json({ ok: true });
          },
        };
      },
    },
  };
  assert.equal(
    (await worker.fetch(request("/api/board"), bindings)).status,
    200,
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      await worker.fetch(request("/api/board"), {
        ...bindings,
        PUBLIC_LIMITER: { limit: async () => ({ success: false }) },
      })
    ).status,
    429,
  );
  assert.equal(calls, 1);
});

test("学校日程POSTも固定path・Origin・rate後に既存History DOだけへ届く", async () => {
  let calls = 0;
  const worker = createWorker(undefined, async () => {
    throw Error("no general API");
  });
  const bindings = {
    ...env,
    ESTIMATE_HOURS_READ_ENABLED: "true",
    HISTORY: {
      getByName: (name: string) => {
        assert.equal(name, "engineer-first/idea-boost:observations-v1");
        return {
          fetch: async () => {
            calls++;
            return Response.json({ ok: true });
          },
        };
      },
    },
  };
  assert.equal(
    (
      await worker.fetch(
        request("/api/burndown/schedule?milestone=9", "POST"),
        bindings,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await worker.fetch(
        request(
          "/api/burndown/schedule?milestone=9",
          "POST",
          "https://evil.test",
        ),
        bindings,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/api/burndown/schedule?milestone=9&repo=evil", "POST"),
        bindings,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/api/burndown/schedule?milestone=9", "POST"),
        {
          ...bindings,
          PUBLIC_LIMITER: { limit: async () => ({ success: false }) },
        },
      )
    ).status,
    429,
  );
  assert.equal(calls, 1);
});
