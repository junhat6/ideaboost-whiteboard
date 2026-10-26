// One observer per connected dialog; no byte/credential cache. Limit expensive
// image transfers while leaving document input and user-triggered video separate.
const managers = new WeakMap(),
  jobs = new WeakMap();
const LIMIT = 3;
function managerFor(root) {
  const key = root || document;
  let manager = managers.get(key);
  if (manager) return manager;
  manager = {
    root,
    key,
    active: 0,
    queue: [],
    jobs: new Set(),
    observer: null,
  };
  manager.observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const job = jobs.get(entry.target);
        if (!job || job.manager !== manager) continue;
        if (!job.image.isConnected || !job.target.contains(job.image)) {
          cancel(job);
          continue;
        }
        job.near = entry.isIntersecting;
        if (job.near && job.state === "waiting") enqueue(job);
      }
    },
    { root, rootMargin: "200px" },
  );
  managers.set(key, manager);
  return manager;
}
function enqueue(job) {
  job.state = "queued";
  job.manager.queue.push(job);
  pump(job.manager);
}
function pump(manager) {
  // Live widgets remain connected during the drawer's exit animation.
  // Connection alone must never authorize more transfers after accepted close.
  if (
    manager.root &&
    (!manager.root.open || manager.root.classList.contains("closing"))
  ) {
    for (const job of [...manager.jobs]) cancel(job);
    return;
  }
  while (manager.active < LIMIT && manager.queue.length) {
    const job = manager.queue.shift();
    if (job.state !== "queued") continue;
    if (!job.image.isConnected || !job.target.contains(job.image)) {
      cancel(job);
      continue;
    }
    if (!job.near) {
      job.state = "waiting";
      continue;
    }
    job.state = "active";
    manager.active++;
    manager.observer.unobserve(job.image);
    const finish = () => finishJob(job);
    job.finish = finish;
    job.image.addEventListener("load", finish);
    job.image.addEventListener("error", finish);
    job.timer = setTimeout(() => {
      if (job.state === "active") {
        job.image.removeAttribute("src");
        job.image.dispatchEvent(new Event("error"));
      }
    }, 45000);
    job.image.src = job.url;
    delete job.image.dataset.mediaSrc;
  }
}
function finishJob(job) {
  if (job.state === "done") return;
  const manager = job.manager;
  if (job.state === "active") manager.active--;
  job.state = "done";
  clearTimeout(job.timer);
  manager.observer.unobserve(job.image);
  if (job.finish) {
    job.image.removeEventListener("load", job.finish);
    job.image.removeEventListener("error", job.finish);
  }
  manager.jobs.delete(job);
  jobs.delete(job.image);
  manager.queue = manager.queue.filter((j) => j !== job);
  // Cleanup may clear many sibling previews synchronously. Pump only after the
  // whole close/private-scope operation finishes, never start their queued URLs.
  queueMicrotask(() => pump(manager));
  if (!manager.jobs.size) {
    manager.observer.disconnect();
    managers.delete(manager.key);
  }
}
function cancel(job) {
  // Clear callbacks before removing src: late network completion cannot update a
  // replacement figure or restart another request for this old target.
  job.image.onload = null;
  job.image.onerror = null;
  job.image.removeAttribute("src");
  delete job.image.dataset.mediaSrc;
  finishJob(job);
}
export function observeImages(target, images, eager = false) {
  // Block.toDOM and comment rendering call this before connection. Resolve the
  // actual scrolling dialog after insertion, never accidentally use root=null.
  queueMicrotask(() => {
    if (!target.isConnected) return;
    const pending = images.filter(
      (image) => target.contains(image) && image.dataset.mediaSrc,
    );
    if (!pending.length) return;
    const root = target.closest("dialog");
    if (root && (!root.open || root.classList.contains("closing"))) return;
    const manager = managerFor(root);
    for (const image of pending) {
      if (jobs.has(image)) continue;
      const job = {
        image,
        target,
        url: image.dataset.mediaSrc,
        manager,
        near: eager,
        state: "waiting",
        timer: null,
        finish: null,
      };
      jobs.set(image, job);
      manager.jobs.add(job);
      if (eager) enqueue(job);
      else manager.observer.observe(image);
    }
  });
}
export function releaseImages(target) {
  target.querySelectorAll("img").forEach((image) => {
    const job = jobs.get(image);
    if (job) cancel(job);
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
    delete image.dataset.mediaSrc;
  });
}
