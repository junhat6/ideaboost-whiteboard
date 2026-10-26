const REPOSITORY = "engineer-first/idea-boost";
/** Only formal closing/manual links, and only public PRs in the dedicated repository. */
export function normalizeLinkedPrs(connection) {
  if (
    !Array.isArray(connection?.nodes) ||
    connection.nodes.length > 50 ||
    typeof connection.pageInfo?.hasNextPage !== "boolean"
  )
    throw Error("invalid_linked_pr_response");
  const prs = [];
  for (const p of connection.nodes) {
    if (
      !p ||
      typeof p !== "object" ||
      typeof p.repository?.isPrivate !== "boolean" ||
      typeof p.repository?.nameWithOwner !== "string"
    )
      throw Error("invalid_linked_pr_response");
    if (
      p.repository.isPrivate !== false ||
      p.repository?.nameWithOwner !== REPOSITORY
    )
      continue;
    if (
      !Number.isSafeInteger(p.number) ||
      p.number < 1 ||
      typeof p.title !== "string" ||
      !["OPEN", "CLOSED", "MERGED"].includes(p.state) ||
      typeof p.isDraft !== "boolean" ||
      p.url !== `https://github.com/${REPOSITORY}/pull/${p.number}`
    )
      throw Error("invalid_linked_pr_response");
    prs.push({
      number: p.number,
      title: p.title,
      url: p.url,
      state: p.state,
      isDraft: p.isDraft,
    });
  }
  const next = connection.pageInfo.hasNextPage
    ? connection.pageInfo.endCursor
    : null;
  if (
    connection.pageInfo.hasNextPage &&
    (typeof next !== "string" || !/^[A-Za-z0-9_+/=-]{1,500}$/.test(next))
  )
    throw Error("invalid_linked_pr_response");
  return { prs, nextCursor: next };
}
