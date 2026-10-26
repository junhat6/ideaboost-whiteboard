const OWNER = "engineer-first",
  REPO = "idea-boost",
  PROJECT = 3;
const STATUSES = [
  "未整理",
  "壁打ち中",
  "着手可能",
  "作業中",
  "レビュー中",
  "完了",
  "見送り",
];
const BASE = "https://api.github.com";
const CORE = `id number url title body updatedAt state repository { nameWithOwner } issueType { name } milestone { number title state } assignees(first:100) { nodes { login name avatarUrl } pageInfo { hasNextPage } }`;
const ISSUE = `${CORE} parent { ${CORE} }`;
const VISIBILITY = `query PublicScope { repository(owner:"${OWNER}",name:"${REPO}") { isPrivate } organization(login:"${OWNER}") { projectV2(number:${PROJECT}) { public } } }`;
const META = `query BoardMeta { organization(login:"${OWNER}") { projectV2(number:${PROJECT}) { id url field(name:"Status") { ... on ProjectV2SingleSelectField { id name options { id name } } } view(number:16) { filter } } } }`;
const ITEMS = `query BoardItems($after:String,$filter:String) { organization(login:"${OWNER}") { projectV2(number:${PROJECT}) { items(first:100,after:$after,query:$filter) { nodes { id isArchived content { ... on Issue { ${ISSUE} } } fieldValueByName(name:"Status") { ... on ProjectV2ItemFieldSingleSelectValue { name optionId } } } pageInfo { hasNextPage endCursor } } } } }`;
class ApiError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      vary: "Origin, x-verified-user-id",
    },
  });
}
const bytes = (s) => new TextEncoder().encode(s);
export async function fingerprint(issue) {
  const users = (
    Array.isArray(issue.assignees) ? issue.assignees : issue.assignees.nodes
  )
    .map((a) => a.login.toLowerCase())
    .sort();
  const value = JSON.stringify([issue.title, issue.body, users]);
  return [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value))),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
const b64 = (b) =>
  btoa(String.fromCharCode(...b))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
function der(tag, body) {
  let n = body.length,
    a = [];
  do {
    a.unshift(n & 255);
    n >>>= 8;
  } while (n);
  return Uint8Array.from([
    tag,
    ...(body.length < 128 ? [body.length] : [128 | a.length, ...a]),
    ...body,
  ]);
}
export function pemToPkcs8(pem) {
  const match = pem
    .replace(/\\n/g, "\n")
    .trim()
    .match(
      /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\s+([A-Za-z0-9+/=\s]+)-----END \1-----$/,
    );
  if (!match) throw new ApiError(503, "invalid_private_key");
  let data = Uint8Array.from(atob(match[2].replace(/\s/g, "")), (c) =>
    c.charCodeAt(0),
  );
  if (match[1] === "RSA PRIVATE KEY")
    data = der(48, [
      2,
      1,
      0,
      48,
      13,
      6,
      9,
      42,
      134,
      72,
      134,
      247,
      13,
      1,
      1,
      1,
      5,
      0,
      ...der(4, data),
    ]);
  return data;
}
export function validateMutation(v) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some(
      (k) =>
        ![
          "title",
          "body",
          "assignees",
          "status",
          "expectedRevision",
          "expectedStatus",
          "expectedFingerprint",
          "requestId",
        ].includes(k),
    )
  )
    throw new ApiError(400, "invalid_fields");
  if (
    typeof v.expectedFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.expectedFingerprint)
  )
    throw new ApiError(400, "invalid_precondition");
  if (
    typeof v.expectedRevision !== "string" ||
    v.expectedRevision.length > 64 ||
    !Number.isFinite(Date.parse(v.expectedRevision)) ||
    !Object.hasOwn(v, "expectedStatus") ||
    (v.expectedStatus !== null &&
      (typeof v.expectedStatus !== "string" ||
        v.expectedStatus.length > 100)) ||
    typeof v.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,100}$/.test(v.requestId)
  )
    throw new ApiError(400, "invalid_precondition");
  if (
    "title" in v &&
    (typeof v.title !== "string" || !v.title.trim() || v.title.length > 256)
  )
    throw new ApiError(400, "invalid_title");
  if (
    "body" in v &&
    (typeof v.body !== "string" || bytes(v.body).length > 60000)
  )
    throw new ApiError(400, "invalid_body");
  if (
    "assignees" in v &&
    (!Array.isArray(v.assignees) ||
      v.assignees.length > 10 ||
      v.assignees.some(
        (a) =>
          typeof a !== "string" ||
          !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(a),
      ) ||
      new Set(v.assignees.map((a) => a.toLowerCase())).size !==
        v.assignees.length)
  )
    throw new ApiError(400, "invalid_assignees");
  if ("status" in v && v.status !== null && !STATUSES.includes(v.status))
    throw new ApiError(400, "invalid_status");
  if (!["title", "body", "assignees", "status"].some((k) => k in v))
    throw new ApiError(400, "no_changes");
}
export function createHandler({
  fetch: fetcher = globalThis.fetch,
  crypto: crypt = globalThis.crypto,
  now = () => Date.now(),
} = {}) {
  const tokens = new Map(),
    locks = new Set(),
    requests = new Map();
  async function token(env) {
    const key =
      env.GITHUB_APP_ID +
      ":" +
      env.GITHUB_INSTALLATION_ID +
      ":" +
      env.GITHUB_APP_PRIVATE_KEY;
    const old = tokens.get(key);
    if (old && old.until > now() + 60000) return old.value;
    const t = Math.floor(now() / 1000),
      head = b64(bytes(JSON.stringify({ alg: "RS256", typ: "JWT" }))),
      body = b64(
        bytes(
          JSON.stringify({
            iat: t - 60,
            exp: t + 540,
            iss: String(env.GITHUB_APP_ID),
          }),
        ),
      );
    let privateKey;
    try {
      privateKey = await crypt.subtle.importKey(
        "pkcs8",
        pemToPkcs8(env.GITHUB_APP_PRIVATE_KEY),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
    } catch {
      throw new ApiError(503, "invalid_private_key");
    }
    const sig = await crypt.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      bytes(head + "." + body),
    );
    const r = await fetcher(
      `${BASE}/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
      {
        method: "POST",
        headers: headers(`${head}.${body}.${b64(new Uint8Array(sig))}`),
        body: JSON.stringify({
          repositories: [REPO],
          permissions: { issues: "write", organization_projects: "write" },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok) throw new ApiError(502, "github_auth_failed");
    const data = await r.json();
    if (!data.token || !Number.isFinite(Date.parse(data.expires_at)))
      throw new ApiError(502, "github_auth_failed");
    tokens.clear();
    tokens.set(key, { value: data.token, until: Date.parse(data.expires_at) });
    return data.token;
  }
  function headers(t) {
    return {
      authorization: `Bearer ${t}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2026-03-10",
      "user-agent": "idea-boost-private-board",
    };
  }
  async function api(env, path, { method = "GET", body } = {}) {
    const t = await token(env);
    let r;
    try {
      r = await fetcher(BASE + path, {
        method,
        headers: headers(t),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ApiError(502, "github_network_error", {
        uncertain: method !== "GET",
      });
    }
    let data;
    try {
      data = await r.json();
    } catch {
      throw new ApiError(502, "github_invalid_response", {
        uncertain: method !== "GET",
      });
    }
    if (!r.ok)
      throw new ApiError(502, "github_request_failed", {
        upstreamStatus: r.status,
        uncertain: method !== "GET" && r.status >= 500,
      });
    return data;
  }
  async function gql(env, query, variables = {}) {
    const r = await api(env, "/graphql", {
      method: "POST",
      body: { query, variables },
    });
    if (r.errors?.length)
      throw new ApiError(502, "github_graphql_error", {
        uncertain: query.startsWith("mutation"),
      });
    return r.data;
  }
  async function assertPublic(env) {
    if (env.AUTH_MODE !== "public-temporary") return;
    const data = await gql(env, VISIBILITY);
    if (
      data?.repository?.isPrivate !== false ||
      data?.organization?.projectV2?.public !== true
    )
      throw new ApiError(403, "scope_not_public");
  }
  async function assignees(env) {
    let result = [];
    for (let page = 1; page <= 100; page++) {
      const rows = await api(
        env,
        `/repos/${OWNER}/${REPO}/assignees?per_page=100&page=${page}`,
      );
      if (!Array.isArray(rows)) throw new ApiError(502, "invalid_assignees");
      result.push(
        ...rows.map((a) => ({
          login: a.login,
          name: a.name ?? null,
          avatarUrl: a.avatar_url,
        })),
      );
      if (rows.length < 100) return result;
    }
    throw new ApiError(502, "assignees_limit");
  }
  function normalize(i, item = null) {
    if (i.assignees.pageInfo?.hasNextPage)
      throw new ApiError(502, "assignees_truncated");
    return {
      id: i.id,
      nodeId: i.id,
      number: i.number,
      url: i.url,
      title: i.title,
      body: i.body,
      type: i.issueType?.name ?? null,
      assignees: i.assignees.nodes,
      status: item?.fieldValueByName?.name ?? null,
      revision: i.updatedAt,
      projectItemId: item?.id ?? null,
      statusEditable: !!item?.id,
      parentId: i.parent?.id ?? null,
      milestone: i.milestone ?? null,
      state: i.state,
    };
  }
  async function board(env, milestone = null, applyView = true) {
    const timings = [];
    const read = async (name, operation) => {
      const start = performance.now();
      try {
        return await operation();
      } finally {
        timings.push(`${name};dur=${(performance.now() - start).toFixed(1)}`);
      }
    };
    await read("visibility", () => assertPublic(env));
    const meta = (await read("meta", () => gql(env, META)))?.organization
      ?.projectV2;
    if (!meta) throw new ApiError(502, "project_unavailable");
    const viewFilter = meta.view?.filter ?? null;
    const filterApplied =
      applyView && !!meta.view && !/@/.test(viewFilter ?? "");
    const all = new Map(),
      parents = new Map();
    let after = null,
      done = false;
    for (let page = 0; page < 100; page++) {
      const connection = (
        await read("items", () => gql(env, ITEMS, { after, filter: "" }))
      )?.organization?.projectV2?.items;
      if (!connection) throw new ApiError(502, "project_items_unavailable");
      for (const item of connection.nodes) {
        const i = item?.content;
        if (
          item.isArchived ||
          !i?.id ||
          i.repository?.nameWithOwner !== `${OWNER}/${REPO}`
        )
          continue;
        all.set(i.id, normalize(i, item));
        if (i.parent?.repository?.nameWithOwner === `${OWNER}/${REPO}`)
          parents.set(i.parent.id, normalize(i.parent));
      }
      if (!connection.pageInfo.hasNextPage) {
        done = true;
        break;
      }
      if (
        !connection.pageInfo.endCursor ||
        connection.pageInfo.endCursor === after
      )
        throw new ApiError(502, "pagination_error");
      after = connection.pageInfo.endCursor;
    }
    if (!done) throw new ApiError(502, "project_too_large");
    // A parent excluded by the view may still be in Project 3: fetch its real membership/status.
    const missing = [...parents.values()].filter(
      (p) => p.type === "PBI" && !all.has(p.id),
    );
    for (let offset = 0; offset < missing.length; offset += 50) {
      const group = missing.slice(offset, offset + 50);
      const data = await gql(
        env,
        `query ParentMembership($ids:[ID!]!) { nodes(ids:$ids) { ... on Issue { id projectItems(first:100) { nodes { id project { id } fieldValueByName(name:"Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } pageInfo { hasNextPage } } } } }`,
        { ids: group.map((p) => p.id) },
      );
      for (const p of group) {
        const node = data?.nodes?.find((n) => n?.id === p.id);
        if (!node?.projectItems || node.projectItems.pageInfo.hasNextPage)
          throw new ApiError(502, "parent_membership_unavailable");
        const item = node.projectItems.nodes.find(
          (i) => i.project.id === meta.id,
        );
        if (item) {
          p.projectItemId = item.id;
          p.statusEditable = true;
          p.status = item.fieldValueByName?.name ?? null;
        }
      }
    }

    const warnings = [];
    if (viewFilter && !filterApplied)
      warnings.push(
        "GitHub view 16 のフィルターは未適用です。リポジトリ内の非アーカイブ Project 項目を表示しています。",
      );
    if (!meta.view)
      warnings.push("GitHub view 16 の定義を取得できませんでした。");
    // The saved view selects PBI ROWS, not the child workflow cards.
    let rowIDs = null;
    if (filterApplied) {
      rowIDs = new Set();
      let cursor = null,
        complete = false;
      const query = `query BoardRows($after:String,$filter:String) { organization(login:"${OWNER}") { projectV2(number:${PROJECT}) { items(first:100,after:$after,query:$filter) { nodes { isArchived content { ... on Issue { id issueType { name } repository { nameWithOwner } } } } pageInfo { hasNextPage endCursor } } } } }`;
      for (let page = 0; page < 100; page++) {
        const c = (
          await read("rows", () =>
            gql(env, query, { after: cursor, filter: viewFilter ?? "" }),
          )
        )?.organization?.projectV2?.items;
        if (!c) throw new ApiError(502, "view_rows_unavailable");
        for (const item of c.nodes) {
          const i = item?.content;
          if (
            !item?.isArchived &&
            i?.issueType?.name === "PBI" &&
            i.repository?.nameWithOwner === `${OWNER}/${REPO}`
          )
            rowIDs.add(i.id);
        }
        if (!c.pageInfo.hasNextPage) {
          complete = true;
          break;
        }
        if (!c.pageInfo.endCursor || c.pageInfo.endCursor === cursor)
          throw new ApiError(502, "pagination_error");
        cursor = c.pageInfo.endCursor;
      }
      if (!complete) throw new ApiError(502, "project_too_large");
      warnings.push(
        "view 16 のフィルターはPBI行に適用しています。カードは選択PBIの正式な子IssueをProject全体から展開しているため、カード自体にはこのフィルターを適用していません。",
      );
    }
    const milestones = [
      ...new Map(
        [...all.values()]
          .filter((i) => i.milestone)
          .map((i) => [i.milestone.number, i.milestone]),
      ).values(),
    ];
    const candidates = new Map(
      [...all.values(), ...parents.values()]
        .filter((i) => i.type === "PBI" && (!rowIDs || rowIDs.has(i.id)))
        .map((i) => [i.id, all.get(i.id) || i]),
    );
    function pbiAncestor(task) {
      let id = task.parentId;
      const visited = new Set([task.id]);
      while (id && !visited.has(id)) {
        visited.add(id);
        const p = all.get(id) || parents.get(id);
        if (!p) return null;
        if (p.type === "PBI") return candidates.get(p.id) || null;
        id = p.parentId;
      }
      return null;
    }
    const tasks = [];
    for (const task of all.values()) {
      if (task.type === "PBI") continue;
      const p = pbiAncestor(task);
      if (rowIDs && !p) continue;
      if (
        milestone !== null &&
        task.milestone?.number !== milestone &&
        p?.milestone?.number !== milestone
      )
        continue;
      task.lane = p?.id ?? null;
      if (!p) task.unresolvedParentId = task.parentId;
      tasks.push(task);
    }
    const used = new Set(tasks.map((t) => t.lane));
    const lanes = [...candidates.values()].filter(
      (p) =>
        milestone === null ||
        p.milestone?.number === milestone ||
        used.has(p.id),
    );
    if (tasks.some((t) => t.lane === null))
      warnings.push(
        "正式な PBI 親が未設定・取得不可の Issue は親未設定として表示しています。",
      );
    // Only formal same-repository PBI parents referenced by in-project tasks enter write scope.
    for (const task of all.values()) {
      const p = parents.get(task.parentId);
      if (p?.type === "PBI" && !all.has(p.id)) all.set(p.id, p);
    }
    for (const item of new Set([...all.values(), ...lanes, ...tasks]))
      item.fingerprint = await fingerprint(item);
    const options = await read("assignees", () => assignees(env));
    const output = {
      lanes,
      tasks,
      assigneeOptions: options,
      scope: {
        owner: OWNER,
        repo: REPO,
        projectNumber: PROJECT,
        projectUrl: meta.url,
        viewNumber: 16,
        viewFilter,
        filterApplied,
        filterTarget: "PBI rows",
        childTasksExpanded: true,
        milestone,
        selectedMilestone: milestone,
        milestones,
        statusOptions: meta.field?.options?.map((o) => o.name) ?? [],
        concurrency:
          "per-issue durable coordinator; optimistic GitHub preflight",
      },
      fetchedAt: new Date(now()).toISOString(),
      warnings,
    };
    await read("visibilityEnd", () => assertPublic(env));
    return { output, meta, all, timings };
  }
  const equalUsers = (a, b) =>
    JSON.stringify(
      a
        .map((x) =>
          typeof x === "string" ? x.toLowerCase() : x.login.toLowerCase(),
        )
        .sort(),
    ) ===
    JSON.stringify(
      b
        .map((x) =>
          typeof x === "string" ? x.toLowerCase() : x.login.toLowerCase(),
        )
        .sort(),
    );
  async function save(env, number, v) {
    const before = await board(env, null, false),
      current = [...before.all.values()].find((i) => i.number === number);
    if (!current) throw new ApiError(404, "issue_not_in_project");
    if (
      current.revision !== v.expectedRevision ||
      current.status !== v.expectedStatus ||
      current.fingerprint !== v.expectedFingerprint
    )
      throw new ApiError(409, "conflict", { issue: current });
    const patch = {};
    for (const k of ["title", "body"])
      if (k in v && v[k] !== current[k]) patch[k] = v[k];
    if ("assignees" in v && !equalUsers(v.assignees, current.assignees)) {
      const allowed = new Set(
        before.output.assigneeOptions.map((a) => a.login.toLowerCase()),
      );
      if (v.assignees.some((a) => !allowed.has(a.toLowerCase())))
        throw new ApiError(400, "assignee_not_assignable");
      patch.assignees = v.assignees;
    }
    const changeStatus = "status" in v && v.status !== current.status;
    let option;
    if (changeStatus) {
      if (!current.projectItemId)
        throw new ApiError(409, "issue_not_in_project_status");
      if (!before.meta.field?.id)
        throw new ApiError(409, "status_field_missing");
      if (v.status !== null) {
        option = before.meta.field.options.find((o) => o.name === v.status);
        if (!option) throw new ApiError(409, "status_option_missing");
      }
    }
    // Narrow final preflight after the paginated board/assignee read. Still not atomic CAS.
    const freshQuery = `query SavePreflight($number:Int!,$item:ID!) { repository(owner:"${OWNER}",name:"${REPO}") { issue(number:$number) { id updatedAt title body assignees(first:100) { nodes { login } pageInfo { hasNextPage } } } } node(id:$item) { ... on ProjectV2Item { id fieldValueByName(name:"Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } }`;
    const fresh = await gql(env, freshQuery, {
      number,
      item: current.projectItemId ?? current.id,
    });
    if (
      fresh?.repository?.issue?.id !== current.id ||
      fresh.repository.issue.updatedAt !== v.expectedRevision ||
      fresh.repository.issue.assignees?.pageInfo?.hasNextPage ||
      (await fingerprint(fresh.repository.issue)) !== v.expectedFingerprint ||
      (current.projectItemId &&
        (!fresh.node?.id ||
          (fresh.node.fieldValueByName?.name ?? null) !== v.expectedStatus))
    )
      throw new ApiError(409, "conflict", { issue: current });
    const completed = [];
    let failure = null;
    try {
      if (Object.keys(patch).length) {
        await api(env, `/repos/${OWNER}/${REPO}/issues/${number}`, {
          method: "PATCH",
          body: patch,
        });
        completed.push("issue");
      }
      if (changeStatus) {
        const clear = v.status === null;
        const query = clear
          ? "mutation ClearStatus($input:ClearProjectV2ItemFieldValueInput!) { clearProjectV2ItemFieldValue(input:$input) { projectV2Item { id } } }"
          : "mutation SetStatus($input:UpdateProjectV2ItemFieldValueInput!) { updateProjectV2ItemFieldValue(input:$input) { projectV2Item { id } } }";
        await gql(env, query, {
          input: {
            projectId: before.meta.id,
            itemId: current.projectItemId,
            fieldId: before.meta.field.id,
            ...(clear ? {} : { value: { singleSelectOptionId: option.id } }),
          },
        });
        completed.push("status");
      }
    } catch (e) {
      failure = e;
    }
    let latest;
    try {
      latest = await board(env, null, false);
    } catch {
      return {
        status: 502,
        data: {
          ok: false,
          error: "readback_failed",
          partial: completed.length > 0,
          ambiguous: true,
          completed,
          issue: null,
          board: null,
        },
      };
    }
    const actual =
      [...latest.all.values()].find((i) => i.number === number) ?? null;
    const confirmed =
      actual &&
      Object.entries(patch).every(([k, val]) =>
        k === "assignees"
          ? equalUsers(val, actual.assignees)
          : val === actual[k],
      ) &&
      (!changeStatus || actual.status === v.status);
    if (failure || !confirmed)
      return {
        status: 502,
        data: {
          ok: false,
          error: failure?.code ?? "readback_mismatch",
          partial: completed.length > 0,
          ambiguous: !!failure?.extra?.uncertain || !confirmed,
          completed,
          issue: actual,
          board: null,
        },
      };
    return { status: 200, data: { ok: true, issue: actual, board: null } };
  }
  return async function handleApi(request, env = {}) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return null;
    try {
      // Routing principal is set only by the Worker (verified member or explicit public mode).
      if (!request.headers.get("x-verified-user-id"))
        throw new ApiError(401, "sign_in_required");
      if (
        request.method === "POST" &&
        request.headers.get("origin") !== url.origin
      )
        throw new ApiError(403, "origin_mismatch");
      const configured = !!(
        env.GITHUB_APP_ID &&
        /^\d+$/.test(String(env.GITHUB_INSTALLATION_ID)) &&
        env.GITHUB_APP_PRIVATE_KEY
      );
      if (url.pathname === "/api/health" && request.method === "GET")
        return reply({
          configured,
          mode: configured ? "github" : "unconfigured",
          accessMode:
            env.AUTH_MODE === "public-temporary" ? "public-temporary" : "team",
        });
      if (!configured) throw new ApiError(503, "github_not_configured");
      if (request.method === "GET" && url.pathname === "/api/board") {
        if (
          [...url.searchParams.keys()].some((k) => k !== "milestone") ||
          url.searchParams.getAll("milestone").length > 1
        )
          throw new ApiError(400, "invalid_query");
        const value = url.searchParams.get("milestone");
        if (value !== null && !/^[1-9]\d{0,8}$/.test(value))
          throw new ApiError(400, "invalid_milestone");
        const result = await board(env, value === null ? null : Number(value));
        const response = reply(result.output);
        response.headers.set("Server-Timing", result.timings.join(", "));
        return response;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/assignees" &&
        !url.search
      ) {
        await assertPublic(env);
        const options = await assignees(env);
        await assertPublic(env);
        return reply({ assigneeOptions: options });
      }
      const match = url.pathname.match(/^\/api\/issues\/([1-9]\d{0,8})$/);
      if (request.method !== "POST" || !match || url.search)
        throw new ApiError(404, "not_found");
      if (
        !/^application\/json(?:;|$)/i.test(
          request.headers.get("content-type") ?? "",
        )
      )
        throw new ApiError(415, "json_required");
      if (Number(request.headers.get("content-length")) > 70000)
        throw new ApiError(413, "body_too_large");
      const reader = request.body?.getReader();
      if (!reader) throw new ApiError(400, "invalid_json");
      let chunks = [],
        size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 70000) {
          await reader.cancel();
          throw new ApiError(413, "body_too_large");
        }
        chunks.push(value);
      }
      let v;
      try {
        const buf = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          buf.set(c, at);
          at += c.length;
        }
        v = JSON.parse(new TextDecoder().decode(buf));
      } catch {
        throw new ApiError(400, "invalid_json");
      }
      validateMutation(v);
      const number = Number(match[1]),
        user = request.headers.get("x-verified-user-id"),
        key = `${user}:${v.requestId}`,
        fingerprint = JSON.stringify([
          number,
          ...Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        ]);
      for (const [k, r] of requests) if (r.until < now()) requests.delete(k);
      const prior = requests.get(key);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new ApiError(409, "request_id_reused");
        if (prior.pending) throw new ApiError(409, "request_in_flight");
        return reply(prior.result.data, prior.result.status);
      }
      if (locks.has(number)) throw new ApiError(409, "issue_in_flight");
      if (requests.size >= 1000) throw new ApiError(503, "request_capacity");
      const record = {
        fingerprint,
        pending: true,
        until: now() + 15 * 60 * 1000,
      };
      requests.set(key, record);
      locks.add(number);
      try {
        record.result = await save(env, number, v);
      } catch (e) {
        record.result = {
          status: e.status ?? 502,
          data: {
            ok: false,
            error: e.code ?? "github_unavailable",
            ...e.extra,
          },
        };
      } finally {
        record.pending = false;
        locks.delete(number);
      }
      return reply(record.result.data, record.result.status);
    } catch (e) {
      return reply(
        { ok: false, error: e.code ?? "github_unavailable", ...e.extra },
        e.status ?? 502,
      );
    }
  };
}
export const handleApi = createHandler();
