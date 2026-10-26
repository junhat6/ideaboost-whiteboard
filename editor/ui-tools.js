import {
  computePosition,
  autoUpdate,
  offset,
  flip,
  shift,
} from "@floating-ui/dom";
let active = null,
  tip = null,
  cleanup = null,
  timer = null,
  epoch = 0,
  suppressed = null,
  dragging = false;
function hide() {
  clearTimeout(timer);
  ++epoch;
  cleanup?.();
  cleanup = null;
  if (active && tip) {
    const ids = (active.getAttribute("aria-describedby") || "")
      .split(" ")
      .filter((id) => id && id !== tip.id);
    if (ids.length) active.setAttribute("aria-describedby", ids.join(" "));
    else active.removeAttribute("aria-describedby");
  }
  tip?.remove();
  tip = null;
  active = null;
}
function closeSoon() {
  clearTimeout(timer);
  timer = setTimeout(hide, 120);
}
function trigger(target) {
  const el = target?.closest?.("[data-tooltip], button.compact-icon[title]");
  if (!el) return null;
  if (el.hasAttribute("title")) {
    el.dataset.tooltip = el.title;
    el.removeAttribute("title");
  }
  return el;
}
function show(el) {
  clearTimeout(timer);
  if (!el || dragging || el === suppressed || !el.dataset.tooltip) return;
  if (active === el) return;
  hide();
  active = el;
  const generation = epoch;
  tip = document.createElement("div");
  tip.className = "instant-tooltip";
  tip.role = "tooltip";
  tip.id = `board-tooltip-${generation}`;
  tip.textContent = el.dataset.tooltip;
  (el.closest("dialog[open]") || document.body).append(tip);
  el.setAttribute(
    "aria-describedby",
    [el.getAttribute("aria-describedby"), tip.id].filter(Boolean).join(" "),
  );
  tip.addEventListener("pointerenter", () => clearTimeout(timer));
  tip.addEventListener("pointerleave", closeSoon);
  cleanup = autoUpdate(el, tip, () => {
    const currentTip = tip;
    computePosition(el, currentTip, {
      placement: "bottom",
      strategy: "fixed",
      middleware: [offset(7), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      if (generation === epoch && currentTip === tip)
        Object.assign(tip.style, {
          left: `${x}px`,
          top: `${y}px`,
          visibility: "visible",
        });
    });
  });
}
document.addEventListener("pointerover", (e) => {
  const el = trigger(e.target);
  if (el && !el.contains(e.relatedTarget)) show(el);
});
document.addEventListener("pointerout", (e) => {
  const el = trigger(e.target);
  if (el && !el.contains(e.relatedTarget)) {
    if (suppressed === el) suppressed = null;
    if (!tip?.contains(e.relatedTarget)) closeSoon();
  }
});
document.addEventListener("focusin", (e) => {
  suppressed = null;
  const el = trigger(e.target);
  if (el) show(el);
  else hide();
});
document.addEventListener("focusout", (e) => {
  if (suppressed === e.target) suppressed = null;
  hide();
});
document.addEventListener("pointerdown", hide, true);
document.addEventListener("scroll", hide, true);
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && tip) {
      suppressed = active;
      hide();
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true,
);
// Dynamic controls may replace their label while busy. Remove native titles too.
const observer = new MutationObserver((records) => {
  for (const r of records) {
    const el = r.target;
    if (r.type === "attributes" && el.matches?.("button.compact-icon[title]")) {
      el.dataset.tooltip = el.title;
      el.removeAttribute("title");
    }
  }
  if (
    active &&
    (!active.isConnected ||
      active.closest("dialog.closing") ||
      active.closest("dialog:not([open])"))
  )
    hide();
});
observer.observe(document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["title", "open", "class"],
});
for (const el of document.querySelectorAll("button.compact-icon[title]"))
  trigger(el);

document.addEventListener(
  "dragstart",
  () => {
    dragging = true;
    hide();
  },
  true,
);
document.addEventListener(
  "dragend",
  () => {
    dragging = false;
  },
  true,
);
document.addEventListener(
  "drop",
  () => {
    dragging = false;
  },
  true,
);

// Native popover owns focus/dismissal; Floating UI keeps the helper beside its trigger.
const menu = document.querySelector("#editor-tools");
let menuCleanup = null,
  menuEpoch = 0;
menu.addEventListener("toggle", () => {
  menuCleanup?.();
  menuCleanup = null;
  const generation = ++menuEpoch;
  if (!menu.matches(":popover-open")) return;
  hide();
  const anchor = document.querySelector("#editor-options");
  menuCleanup = autoUpdate(anchor, menu, () => {
    computePosition(anchor, menu, {
      strategy: "fixed",
      placement: "bottom-end",
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      if (generation === menuEpoch && menu.matches(":popover-open"))
        Object.assign(menu.style, {
          inset: "auto",
          left: `${x}px`,
          top: `${y}px`,
        });
    });
  });
});
