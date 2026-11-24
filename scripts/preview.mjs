// Test-only static server. No credentials, GitHub calls or production auth bypass.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { localPorts } from "./worktree/ports.mjs";
const allowed = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/burndown.js", "burndown.js"],
  ["/school-calendar.js", "school-calendar.js"],
  ["/toolbar-select.js", "toolbar-select.js"],
  ["/page-navigation.js", "page-navigation.js"],
  ["/icons.js", "icons.js"],
  ["/ui-tools.js", "ui-tools.js"],
  ["/editor-bundle.js", "editor-bundle.js"],
  ["/diagram-worker.js", "diagram-worker.js"],
  ["/api-adapter.js", "api-adapter.js"],
  ["/team-notes.js", "team-notes.js"],
  ["/styles.css", "styles.css"],
]);
// 付箋の棚の見本。本番の Worker は sample を返さない（無効なら 404 で棚を隠す）。
const teamNotesSample = JSON.stringify({
  ok: true,
  sample: true,
  notes: [
    "ハッカソン告知文を考える",
    "会場の電源と延長コードを確認",
    "スポンサーへのお礼メール",
  ].map((text, i) => ({
    id: "n_sample" + String(i).padStart(4, "0"),
    text,
    done: false,
    rev: 1,
  })),
});
http
  .createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname.replace(
      /^\/b\/[a-f0-9]{48}/,
      "",
    );
    if (pathname === "/api/team-notes" && req.method === "GET") {
      res.setHeader("content-type", "application/json");
      res.end(teamNotesSample);
      return;
    }
    const file = allowed.get(pathname);
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
  .listen(localPorts().preview, "127.0.0.1");
