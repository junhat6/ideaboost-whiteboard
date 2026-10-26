export function validateComment(v) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !["body", "requestId"].includes(k)) ||
    typeof v.body !== "string" ||
    !v.body.trim() ||
    new TextEncoder().encode(v.body).length > 60000 ||
    typeof v.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,100}$/.test(v.requestId)
  )
    throw new Error("invalid_comment");
}
export function normalizeComment(v) {
  if (
    !Number.isSafeInteger(v?.id) ||
    v.id < 1 ||
    typeof v.body !== "string" ||
    (v.user !== null && typeof v.user?.login !== "string") ||
    !Number.isFinite(Date.parse(v.created_at))
  )
    throw new Error("invalid_comment_response");
  return {
    id: v.id,
    body: v.body,
    url: v.html_url,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
    author: {
      login: v.user?.login || "削除されたユーザー",
      avatarUrl: v.user?.avatar_url || null,
      url: v.user?.html_url || null,
      type: v.user?.type || "User",
    },
  };
}
/** All writes run behind the durable Issue coordinator; never retry a POST here. */
export function createComments({ scope, read, write, visibility }) {
  return async (request, number, data) => {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const page = url.searchParams.get("page") ?? "1";
      if (
        [...url.searchParams.keys()].some((k) => k !== "page") ||
        url.searchParams.getAll("page").length > 1 ||
        !/^[1-9]\d{0,2}$/.test(page)
      )
        return Response.json({ error: "invalid_query" }, { status: 400 });
      await scope(number);
      const values = await read(number, Number(page));
      if (!Array.isArray(values) || values.length > 50)
        throw new Error("invalid_comment_response");
      const comments = values.map(normalizeComment);
      await visibility();
      return Response.json({
        comments,
        nextPage: values.length === 50 ? Number(page) + 1 : null,
        fetchedAt: new Date().toISOString(),
      });
    }
    validateComment(data);
    await scope(number);
    await visibility();
    let created;
    try {
      created = normalizeComment(await write(number, data.body));
      await visibility();
    } catch (error) {
      // Successful POST followed by invalid response/visibility failure is also uncertain to this caller.
      const ambiguous = !!created || error.extra?.uncertain !== false;
      return Response.json(
        { ok: false, error: "comment_post_failed", ambiguous },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, comment: created }, { status: 201 });
  };
}
