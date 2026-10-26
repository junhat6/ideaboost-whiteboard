import { render } from "pele";
self.onmessage = ({ data }) => {
  const { id, source } = data;
  try {
    if (
      typeof source !== "string" ||
      source.length > 12000 ||
      source.split("\n").length > 300
    )
      throw Error("limit");
    // User directives/config are not accepted. The renderer has no icon/math resolver.
    if (/^\s*---|%%\s*\{/m.test(source)) throw Error("config");
    const started = performance.now();
    const result = render(source, {
      links: false,
      images: false,
      limit: 12000,
      outputLimit: 500000,
      maxEdges: 150,
      fontSize: 16,
      responsive: true,
      idPrefix: `diagram-${id}`,
    });
    self.postMessage({ id, svg: result.svg, ms: performance.now() - started });
  } catch {
    self.postMessage({ id, error: true });
  }
};
