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
  author: {
    login: "creator",
    name: "作成者",
    avatarUrl: "https://avatars.githubusercontent.com/u/2",
    url: "https://github.com/creator",
    __typename: "User",
  },
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
  commentFailure = false,
  comments = [],
  storyPoints = null,
  fieldsDenied = false,
  closeFailure = false,
  closeUncertain = false,
} = {}) {
  const parent = makeIssue(1, "PBI");
  const issue = makeIssue(2, "Task", parent);
  let status = initialStatus,
    parentStatus = "レビュー中";
  const calls = [];
  const fetch = async (url, opt) => {
    const body = opt.body ? JSON.parse(opt.body) : null;
    calls.push({ url, ...opt, parsed: body });
    if (url.includes("/access_tokens"))
      return Response.json({
        token: "SECRET",
        expires_at: "2099-01-01T00:00:00Z",
      });
    if (url.endsWith("/issue-fields"))
      return fieldsDenied
        ? Response.json({ message: "denied" }, { status: 403 })
        : Response.json([
            {
              id: 49067031,
              name: "Story points",
              data_type: "number",
              visibility: "all",
            },
          ]);
    if (url.includes("/issue-field-values")) {
      if (opt.method === "POST") storyPoints = body.issue_field_values[0].value;
      if (opt.method === "DELETE") {
        storyPoints = null;
        return new Response(null, { status: 204 });
      }
      return Response.json(
        storyPoints === null
          ? []
          : [
              {
                issue_field_id: 49067031,
                data_type: "number",
                value: storyPoints,
              },
            ],
      );
    }
    if (body?.query?.includes("query CommentScope")) {
      const n = body.variables.number;
      const i = n === 1 ? parent : n === 2 ? issue : null;
      return Response.json({
        data: {
          repository: {
            isPrivate: false,
            issue: i && {
              ...i,
              projectItems: {
                nodes:
                  n === 2 || parentInProject
                    ? [{ isArchived: false, project: { id: "PROJ" } }]
                    : [],
                pageInfo: { hasNextPage: false },
              },
            },
          },
          organization: { projectV2: { id: "PROJ", public: true } },
        },
      });
    }
    if (body?.query?.includes("query CommentParentScope"))
      return Response.json({
        data: {
          organization: {
            projectV2: {
              items: {
                nodes: [
                  {
                    isArchived: false,
                    content: {
                      repository: {
                        nameWithOwner: "engineer-first/idea-boost",
                      },
                      parent: { id: "I1" },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        },
      });
    if (url.includes("/assignees"))
      return Response.json([
        {
          login: "alice",
          avatar_url: "https://avatars.githubusercontent.com/a",
        },
      ]);
    if (url.includes("/comments")) {
      if (opt.method === "POST") {
        if (commentFailure) throw Error("uncertain network");
        return Response.json(
          {
            id: 99,
            body: body.body,
            html_url:
              "https://github.com/engineer-first/idea-boost/issues/2#issuecomment-99",
            created_at: revision,
            user: {
              login: "test-app[bot]",
              type: "Bot",
              avatar_url: "https://avatars.githubusercontent.com/u/1",
            },
          },
          { status: 201 },
        );
      }
      return Response.json(comments);
    }
    if (opt.method === "PATCH") {
      const target = url.endsWith("/1") ? parent : issue;
      if (body.state === "closed" && closeFailure)
        return Response.json({ message: "Close denied" }, { status: 403 });
      Object.assign(target, body);
      if (body.state) target.state = body.state.toUpperCase();
      if (body.state_reason)
        target.stateReason = body.state_reason.toUpperCase();
      if (body.state === "closed" && closeUncertain)
        throw Error("Close response lost");
      target.updatedAt = "2026-10-26T00:00:01Z";
      if (networkPatch) throw Error("connection lost");
      return Response.json(issue);
    }
    if (
      body.query.includes("BoardRowsFull") ||
      body.query.includes("BoardChildren")
    ) {
      let nodes = [];
      if (body.query.includes("BoardRowsFull"))
        nodes = [
          {
            id: "ITEM1",
            isArchived: false,
            content: { ...parent, subIssuesSummary: { total: 1 } },
            fieldValueByName: { name: "レビュー中" },
          },
        ];
      else if (body.variables.filter.includes("#1"))
        nodes = [
          {
            id: "ITEM2",
            isArchived: false,
            content: {
              ...issue,
              subIssuesSummary: { total: extraTasks ? 1 : 0 },
            },
            fieldValueByName: status === null ? null : { name: status },
          },
        ];
      else if (body.variables.filter.includes("#2") && extraTasks)
        nodes = [
          {
            id: "ITEM3",
            isArchived: false,
            content: {
              ...makeIssue(3, "Task", issue),
              subIssuesSummary: { total: 0 },
            },
            fieldValueByName: { name: "作業中" },
          },
        ];
      return Response.json({
        data: {
          organization: {
            projectV2: { items: { nodes, pageInfo: { hasNextPage: false } } },
          },
        },
      });
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
    if (body.query.includes("BoardRelations"))
      return Response.json({
        data: {
          nodes: [
            parent,
            issue,
            makeIssue(3, "Task", issue),
            makeIssue(4, "Task"),
          ],
        },
      });
    if (body.query.includes("IssueDetails"))
      return Response.json({
        data: {
          nodes: [
            parent,
            issue,
            makeIssue(3, "Task", issue),
            makeIssue(4, "Task"),
          ],
          statuses: [
            { id: "ITEM1", fieldValueByName: { name: "レビュー中" } },
            {
              id: "ITEM2",
              fieldValueByName: status === null ? null : { name: status },
            },
            { id: "ITEM3", fieldValueByName: { name: "作業中" } },
            { id: "ITEM4", fieldValueByName: null },
          ],
        },
      });
    if (body.query.includes("ParentDetails"))
      return Response.json({ data: { nodes: [parent] } });
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
    if (body.query.includes("MutationContext")) {
      const i = body.variables.number === 1 ? parent : issue;
      return Response.json({
        data: {
          repository: {
            isPrivate: false,
            issue: {
              ...i,
              projectItems: {
                nodes:
                  i === parent && !parentInProject
                    ? []
                    : [
                        {
                          id: i === parent ? "ITEM1" : "ITEM2",
                          isArchived: false,
                          project: { id: "P3" },
                          fieldValueByName:
                            i === parent
                              ? { name: parentStatus }
                              : status === null
                                ? null
                                : { name: status },
                        },
                      ],
                pageInfo: { hasNextPage: false },
              },
            },
          },
          organization: {
            projectV2: {
              id: "P3",
              public: true,
              field: {
                id: "STATUS",
                options: [
                  { id: "WORK", name: "作業中", color: "YELLOW" },
                  { id: "DONE", name: "完了", color: "GREEN" },
                ],
              },
              view: { filter: viewFilter },
            },
          },
        },
      });
    }
    if (body.query.includes("SavePreflight"))
      return Response.json({
        data: {
          repository: { issue: body.variables.number === 1 ? parent : issue },
          node: {
            id: body.variables.number === 1 ? "ITEM1" : "ITEM2",
            fieldValueByName:
              body.variables.number === 1
                ? { name: parentStatus }
                : status === null
                  ? null
                  : { name: status },
          },
        },
      });
    if (body.query.startsWith("mutation")) {
      if (statusFailure)
        return Response.json({ errors: [{ message: "failed" }] });
      const nextStatus = body.query.includes("ClearStatus")
        ? null
        : body.variables.input.value.singleSelectOptionId === "DONE"
          ? "完了"
          : "作業中";
      if (body.variables.input.itemId === "ITEM1") parentStatus = nextStatus;
      else status = nextStatus;
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
                options: [
                  { id: "WORK", name: "作業中", color: "YELLOW" },
                  { id: "DONE", name: "完了", color: "GREEN" },
                ],
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
        repository: { isPrivate: false },
        organization: {
          projectV2: {
            id: "P3",
            public: true,
            url: "https://github.com/orgs/engineer-first/projects/3",
            field: {
              id: "STATUS",
              options: [
                { id: "WORK", name: "作業中", color: "YELLOW" },
                { id: "DONE", name: "完了", color: "GREEN" },
              ],
            },
            view: { filter: viewFilter },
            items: {
              nodes:
                paginate && !body.variables?.after
                  ? []
                  : [
                      ...(/type:PBI/.test(viewFilter)
                        ? [{ id: "ITEM1", isArchived: false, content: parent }]
                        : []),
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
                hasNextPage: paginate && !body.variables?.after,
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
  expectedState: "OPEN",
  expectedStateReason: null,
  requestId: "request_0123456789",
  ...extra,
});
