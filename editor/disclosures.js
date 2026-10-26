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
    const count = (node, depth = 0) => {
      if (depth > 4) return 1000;
      return (
        (node.tagName === "details" ? 1 : 0) +
        (node.childNodes || []).reduce(
          (sum, c) => sum + count(c, depth + (c.tagName === "details" ? 1 : 0)),
          0,
        )
      );
    };
    const valid =
      !!loc.endTag &&
      summary?.tagName === "summary" &&
      !!sl?.endTag &&
      count(n) <= 20;
    const text = (node) =>
      node.nodeName === "#text"
        ? node.value
        : ["script", "style", "svg", "math", "iframe", "object"].includes(
              node.tagName,
            )
          ? ""
          : (node.childNodes || []).map(text).join("");
    result.push({
      from: loc.startOffset,
      to: loc.endOffset,
      valid,
      summary: valid ? text(summary) : "",
      body: valid ? source.slice(sl.endOffset, loc.endTag.startOffset) : "",
      open: n.attrs?.some((a) => a.name === "open") || false,
      raw: source.slice(loc.startOffset, loc.endOffset),
    });
  }
  return result.slice(0, 20);
}
