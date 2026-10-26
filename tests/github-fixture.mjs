import { generateKeyPairSync, webcrypto } from "node:crypto";
import { createHandler, fingerprint } from "../server/github.mjs";
export const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey.export({ type: "pkcs1", format: "pem" });
export const env = {
  GITHUB_APP_ID: "123",
  GITHUB_INSTALLATION_ID: "456",
  GITHUB_APP_PRIVATE_KEY: pem,
};
export const revision = "2026-10-26T00:00:00Z";
export const makeIssue = (n, type = null, parent = null) => ({
  id: "I" + n,
  number: n,
  title: "Issue " + n,
  body: "original",
  url: "https://github.com/engineer-first/idea-boost/issues/" + n,
  updatedAt: revision,
  state: "OPEN",
  repository: { nameWithOwner: "engineer-first/idea-boost" },
  issueType: type ? { name: type } : null,
  parent,
  milestone: { number: 1, title: "Sprint", state: "OPEN" },
  assignees: { nodes: [], pageInfo: { hasNextPage: false } },
});
export function fixture({
  paginate = false,
  statusFailure = false,
  networkPatch = false,
  viewFilter = "milestone:Sprint",
  parentInProject = false,
  initialStatus = null,
  extraTasks = false,
} = {}) {
  const parent = makeIssue(1, "PBI");
  const issue = makeIssue(2, "Task", parent);
  let status = initialStatus;
  const calls = [];
  const fetch = async (url, opt) => {
    const body = opt.body ? JSON.parse(opt.body) : null;
    calls.push({ url, ...opt, parsed: body });
    if (url.includes("/access_tokens"))
      return Response.json({
        token: "SECRET",
        expires_at: "2099-01-01T00:00:00Z",
      });
    if (url.includes("/assignees"))
      return Response.json([
        {
          login: "alice",
          avatar_url: "https://avatars.githubusercontent.com/a",
        },
      ]);
    if (opt.method === "PATCH") {
      const target = url.endsWith("/1") ? parent : issue;
      Object.assign(target, body);
      target.updatedAt = "2026-10-26T00:00:01Z";
      if (networkPatch) throw Error("connection lost");
      return Response.json(issue);
    }
    if (body.query.includes("BoardRows"))
      return Response.json({
        data: {
          organization: {
            projectV2: {
              items: {
                nodes: [{ content: parent, isArchived: false }],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        },
      });
    if (body.query.includes("ParentMembership"))
      return Response.json({
        data: {
          nodes: body.variables.ids.map((id) => ({
            id,
            projectItems: {
              nodes: parentInProject
                ? [
                    {
                      id: "ITEM1",
                      project: { id: "P3" },
                      fieldValueByName: { name: "レビュー中" },
                    },
                  ]
                : [],
              pageInfo: { hasNextPage: false },
            },
          })),
        },
      });
    if (body.query.includes("SavePreflight"))
      return Response.json({
        data: {
          repository: { issue: body.variables.number === 1 ? parent : issue },
          node: {
            id: "ITEM2",
            fieldValueByName: status === null ? null : { name: status },
          },
        },
      });
    if (body.query.startsWith("mutation")) {
      if (statusFailure)
        return Response.json({ errors: [{ message: "failed" }] });
      status = body.query.includes("ClearStatus") ? null : "作業中";
      return Response.json({ data: {} });
    }
    if (body.query.includes("BoardMeta"))
      return Response.json({
        data: {
          organization: {
            projectV2: {
              id: "P3",
              url: "https://github.com/orgs/engineer-first/projects/3",
              field: {
                id: "STATUS",
                options: [{ id: "WORK", name: "作業中" }],
              },
              view: { filter: viewFilter },
            },
          },
        },
      });
    const item = {
      id: "ITEM2",
      content: issue,
      isArchived: false,
      fieldValueByName: status === null ? null : { name: status },
    };
    return Response.json({
      data: {
        organization: {
          projectV2: {
            items: {
              nodes:
                paginate && !body.variables.after
                  ? []
                  : [
                      item,
                      ...(extraTasks
                        ? [
                            {
                              id: "ITEM3",
                              isArchived: false,
                              content: makeIssue(3, "Task", issue),
                              fieldValueByName: { name: "作業中" },
                            },
                            {
                              id: "ITEM4",
                              isArchived: false,
                              content: makeIssue(4, "Task"),
                              fieldValueByName: null,
                            },
                          ]
                        : []),
                    ],
              pageInfo: {
                hasNextPage: paginate && !body.variables.after,
                endCursor: "next",
              },
            },
          },
        },
      },
    });
  };
  return {
    handler: createHandler({ fetch, crypto: webcrypto }),
    newHandler: () => createHandler({ fetch, crypto: webcrypto }),
    fetch,
    calls,
    issue,
  };
}
export function req(path = "/api/board", data = null, headers = {}) {
  return new Request("https://board.example" + path, {
    method: data ? "POST" : "GET",
    headers: {
      "x-verified-user-id": "owner",
      ...(data
        ? {
            "content-type": "application/json",
            origin: "https://board.example",
          }
        : {}),
      ...headers,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
export const originalFingerprint = await fingerprint(makeIssue(2));
export const parentFingerprint = await fingerprint(makeIssue(1));
export const patch = (extra = {}) => ({
  title: "Updated",
  expectedFingerprint: originalFingerprint,
  expectedRevision: revision,
  expectedStatus: null,
  requestId: "request_0123456789",
  ...extra,
});
