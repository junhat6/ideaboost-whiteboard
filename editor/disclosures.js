import { parseFragment } from "parse5";
import { parser } from "@lezer/markdown";
/** Parse inert structure with source offsets; never insert parsed HTML into the browser DOM. */
export function disclosures(source) {
  if (!source.includes("<details") || source.length > 60000) return [];
  const protectedRanges = [];
  parser.parse(source).iterate({
    enter(n) {
      if (["FencedCode", "CodeBlock", "InlineCode"].includes(n.name)) {
        protectedRanges.push([n.from, n.to]);
        return false;
      }
    },
  });
  let masked = source;
  for (const [from, to] of protectedRanges.reverse())
    masked =
      masked.slice(0, from) +
      masked.slice(from, to).replace(/[^\r\n]/g, " ") +
      masked.slice(to);
  const tree = parseFragment(masked, { sourceCodeLocationInfo: true });
  const result = [];
  for (const n of tree.childNodes) {
    if (
      n.tagName !== "details" ||
      n.namespaceURI !== "http://www.w3.org/1999/xhtml"
    )
      continue;
    const loc = n.sourceCodeLocation;
    if (
      !loc?.startTag ||
      !/^ {0,3}$/.test(
        source.slice(
          source.lastIndexOf("\n", loc.startOffset - 1) + 1,
          loc.startOffset,
        ),
      )
    )
      continue;
    const children = (n.childNodes || []).filter(
      (c) => c.nodeName !== "#text" || c.value.trim(),
    );
    const summary = children[0],
      sl = summary?.sourceCodeLocation;
    // Bound every HTML node, not just disclosure nesting. No recursive JS walk.
    let bounded = true,
      nodes = 0,
      detailCount = 0;
    const stack = [[n, 0, 0]];
    while (stack.length) {
      const [node, depth, detailsDepth] = stack.pop();
      const nextDetails = detailsDepth + (node.tagName === "details" ? 1 : 0);
      if (++nodes > 2000 || depth > 64 || nextDetails > 4) {
        bounded = false;
        break;
      }
      if (node.tagName === "details" && ++detailCount > 20) {
        bounded = false;
        break;
      }
      for (const child of node.childNodes || [])
        stack.push([child, depth + 1, nextDetails]);
    }
    const valid =
      bounded && !!loc.endTag && summary?.tagName === "summary" && !!sl?.endTag;
    let summaryText = "";
    if (valid) {
      const pending = [summary];
      while (pending.length) {
        const node = pending.pop();
        if (node.nodeName === "#text") summaryText += node.value;
        else if (
          !["script", "style", "svg", "math", "iframe", "object"].includes(
            node.tagName,
          )
        )
          pending.push(...[...(node.childNodes || [])].reverse());
      }
    }
    result.push({
      from: loc.startOffset,
      to: loc.endOffset,
      valid,
      summary: summaryText,
      body: valid ? source.slice(sl.endOffset, loc.endTag.startOffset) : "",
      open: n.attrs?.some((a) => a.name === "open") || false,
      raw: source.slice(loc.startOffset, loc.endOffset),
    });
  }
  return result.slice(0, 20);
}
