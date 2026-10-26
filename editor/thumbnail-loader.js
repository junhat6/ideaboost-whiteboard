// Decoder previews are separate from image transfers: at most one unknown/video
// preview per dialog. Nothing starts until its stable figure is near the viewport.
const roots = new WeakMap(),
  entries = new WeakMap();
function available(root) {
  return !root || (root.open && !root.classList.contains("closing"));
}
function manager(root) {
  const key = root || document;
  let m = roots.get(key);
  if (m) return m;
  m = { root, key, active: 0, queue: [], jobs: new Set(), observer: null };
  m.observer = new IntersectionObserver(
    (list) => {
      for (const e of list) {
        const j = entries.get(e.target);
        if (!j || j.m !== m) continue;
        j.near = e.isIntersecting;
        if (j.near && j.state === "waiting") {
          j.state = "queued";
          m.queue.push(j);
        }
      }
      pump(m);
    },
    { root, rootMargin: "150px" },
  );
  roots.set(key, m);
  return m;
}
function pump(m) {
  if (!available(m.root)) {
    for (const j of [...m.jobs]) dispose(j);
    return;
  }
  while (!m.active && m.queue.length) {
    const j = m.queue.shift();
    if (j.state !== "queued") continue;
    if (!j.figure.isConnected) {
      dispose(j);
      continue;
    }
    if (!j.near) {
      j.state = "waiting";
      continue;
    }
    j.state = "active";
    m.active++;
    m.observer.unobserve(j.figure);
    j.controller = new AbortController();
    j.timer = setTimeout(() => {
      j.controller.abort("timeout");
      finish(j);
    }, 12000);
    Promise.resolve()
      .then(() => j.start(j.controller.signal))
      .catch(() => {})
      .finally(() => finish(j));
  }
}
function finish(j) {
  if (j.state !== "active") return;
  j.state = "done";
  j.m.active--;
  clearTimeout(j.timer);
  queueMicrotask(() => pump(j.m));
}
function dispose(j) {
  const m = j.m;
  if (j.state === "active") {
    m.active--;
    clearTimeout(j.timer);
  }
  j.state = "disposed";
  j.controller?.abort("disposed");
  m.observer.unobserve(j.figure);
  m.jobs.delete(j);
  m.queue = m.queue.filter((x) => x !== j);
  entries.delete(j.figure);
  if (!m.jobs.size) {
    m.observer.disconnect();
    roots.delete(m.key);
  }
  queueMicrotask(() => pump(m));
}
export function observeThumbnails(target, items) {
  queueMicrotask(() => {
    if (!target.isConnected) return;
    const root = target.closest("dialog");
    if (!available(root)) return;
    for (const { figure, start } of items) {
      if (!target.contains(figure) || entries.has(figure)) continue;
      const m = manager(root),
        j = {
          figure,
          start,
          m,
          near: false,
          state: "waiting",
          controller: null,
          timer: null,
        };
      m.jobs.add(j);
      entries.set(figure, j);
      m.observer.observe(figure);
    }
  });
}
export function releaseThumbnails(target) {
  for (const figure of target.querySelectorAll(".media-shell")) {
    const j = entries.get(figure);
    if (j) dispose(j);
  }
}
