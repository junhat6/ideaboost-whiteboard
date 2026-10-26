// Test-only static server. No credentials, GitHub calls or production auth bypass.
import http from "node:http";
import { readFile } from "node:fs/promises";
const allowed = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/icons.js", "icons.js"],
  ["/editor-bundle.js", "editor-bundle.js"],
  ["/diagram-worker.js", "diagram-worker.js"],
  ["/api-adapter.js", "api-adapter.js"],
  ["/styles.css", "styles.css"],
]);
http
  .createServer(async (req, res) => {
    const file = allowed.get(
      new URL(req.url, "http://localhost").pathname.replace(
        /^\/b\/[a-f0-9]{48}/,
        "",
      ),
    );
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const body = await readFile(new URL("../web/" + file, import.meta.url));
      res.setHeader(
        "content-type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end();
    }
  })
  .listen(4183, "127.0.0.1");
