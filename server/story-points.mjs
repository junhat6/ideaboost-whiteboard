/**
 * Read-only projection; production activation requires the optional capability.
 * Evidence must be supplied by a server-side resolver of the agreed Issue field
 * ID/type/visibility, never by request parameters or Project/body fallbacks.
 * undefined = unavailable/not publishable; null = verified public field is unset.
 */
export function publicPbiStoryPoints({
  issueType,
  value,
  fieldVerified,
  fieldPublic,
}) {
  if (issueType !== "PBI" || fieldVerified !== true || fieldPublic !== true)
    return undefined;
  if (value === null) return null;
  // Reading is not rubric enforcement: preserve canonical numbers, never round
  // or silently convert a string, estimate from children, or replace with zero.
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

// 後読込 reader。引数はサーバーが確認した契約・PBIだけを渡す。
// getValues は HTTP adapter が pagination を検証した {data, hasNextPage}。
// 空の結果は既存表示を消すための置換結果であり、以前の値との merge は禁止。
export async function readPublicPbiStoryPoints({
  approved = false,
  fieldId,
  pbis,
  getDefinitions,
  getValues,
  assertScope,
}) {
  const empty = () => ({ values: {} });
  if (
    approved !== true ||
    !Number.isSafeInteger(fieldId) ||
    fieldId <= 0 ||
    !Array.isArray(pbis) ||
    pbis.length > 6 ||
    pbis.some(
      (p) =>
        p?.type !== "PBI" || !Number.isSafeInteger(p.number) || p.number <= 0,
    ) ||
    new Set(pbis.map((p) => p.number)).size !== pbis.length
  )
    return empty();
  const verify = async () => {
    if ((await assertScope()) !== true) throw new Error("scope_unverified");
    const definitions = await getDefinitions();
    if (!Array.isArray(definitions)) throw new Error("fields_unverified");
    const matches = definitions.filter((f) => f?.id === fieldId);
    if (
      matches.length !== 1 ||
      matches[0].name !== "Story points" ||
      matches[0].data_type !== "number" ||
      matches[0].visibility !== "all"
    )
      throw new Error("field_unverified");
  };
  try {
    await verify();
    const values = {};
    let next = 0;
    const read = async () => {
      while (next < pbis.length) {
        const { number } = pbis[next++];
        try {
          let value = null,
            found = false,
            complete = false;
          for (let page = 1; page <= 10; page++) {
            const result = await getValues(number, { page, per_page: 100 });
            if (
              !Array.isArray(result?.data) ||
              typeof result.hasNextPage !== "boolean"
            )
              throw new Error("values_unverified");
            for (const entry of result.data) {
              if (!entry || !Number.isSafeInteger(entry.issue_field_id))
                throw new Error("values_unverified");
              if (entry.issue_field_id !== fieldId) continue;
              if (
                found ||
                entry.data_type !== "number" ||
                (entry.value !== null &&
                  (typeof entry.value !== "number" ||
                    !Number.isFinite(entry.value)))
              )
                throw new Error("value_unverified");
              found = true;
              value = entry.value;
            }
            if (!result.hasNextPage) {
              complete = true;
              break;
            }
          }
          if (complete) values[number] = value;
        } catch (error) {
          if (error.code === "scope_not_public") throw error;
          /* 個別の失敗を未設定や0と偽らない */
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, pbis.length) }, read));
    await verify();
    return { values };
  } catch (error) {
    if (error.code === "scope_not_public") throw error;
    return empty();
  }
}

// Never follow arbitrary Link URLs. Only the next numeric page of this same endpoint is accepted.
export function storyPointsNextPage(link, currentUrl, page) {
  if (link === null || link === "") return false;
  if (typeof link !== "string") throw new Error("pagination_unverified");
  const entries = link.split(",").map((entry) => entry.trim());
  let next = false;
  for (const entry of entries) {
    const match = entry.match(/^<([^>]+)>;\s*rel="(next|prev|first|last)"$/);
    if (!match) throw new Error("pagination_unverified");
    if (match[2] !== "next") continue;
    if (next) throw new Error("pagination_unverified");
    const actual = new URL(match[1]),
      expected = new URL(currentUrl);
    expected.searchParams.set("page", String(page + 1));
    actual.searchParams.sort();
    expected.searchParams.sort();
    if (actual.href !== expected.href) throw new Error("pagination_unverified");
    next = true;
  }
  return next;
}
