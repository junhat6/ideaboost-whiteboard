// Display-only paging. Never intercept editing, native controls or scrollable
// content, and never translate a trackpad's momentum tail into several pages.
export function attachPageNavigation({ board, enabled, blocked, step }) {
  const doc = board.ownerDocument,
    view = doc.defaultView,
    quietMs = 280,
    threshold = 80,
    dominance = 1.5,
    controls =
      'input, textarea, select, option, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="spinbutton"], [role="combobox"]';
  let dragging = false,
    lastWheel = -Infinity,
    distanceX = 0,
    absoluteX = 0,
    absoluteY = 0,
    axis = null,
    locked = false,
    consumed = false;
  if (!board.hasAttribute("tabindex")) board.tabIndex = 0;

  function resetWheel() {
    distanceX = absoluteX = absoluteY = 0;
    axis = null;
    locked = consumed = false;
  }
  function elementFor(event) {
    return event.target instanceof view.Element ? event.target : null;
  }
  function modified(event) {
    return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  }
  function overlayOpen() {
    const overlays = doc.querySelectorAll(
      'dialog[open], [popover]:popover-open, [data-toolbar-popover]:not([hidden]), [role="dialog"], [role="menu"], [role="listbox"]',
    );
    return [...overlays].some((el) => !el.hidden && el.getClientRects().length);
  }
  function horizontalScroll(target) {
    for (let el = target; el; el = el.parentElement) {
      if (
        /^(auto|scroll|overlay)$/.test(view.getComputedStyle(el).overflowX) &&
        el.scrollWidth > el.clientWidth + 1
      )
        return true;
      // Include the board viewport: narrow screens must retain native horizontal
      // access to the columns, even when that scroller is already at its edge.
      if (el === board.parentElement) break;
    }
    return false;
  }
  function eligible(event, keyboard = false) {
    const target = elementFor(event);
    return (
      enabled() &&
      !blocked?.() &&
      !dragging &&
      !event.defaultPrevented &&
      !modified(event) &&
      !event.isComposing &&
      (!event.buttons || event.type === "pointerdown") &&
      target &&
      board.contains(target) &&
      !target.closest(controls) &&
      (!keyboard || !target.closest('button, a, summary, [role="button"]')) &&
      !overlayOpen() &&
      !horizontalScroll(target)
    );
  }
  function keydown(event) {
    if (
      !["ArrowLeft", "ArrowRight"].includes(event.key) ||
      event.repeat ||
      !eligible(event, true)
    )
      return;
    if (step(event.key === "ArrowRight" ? 1 : -1)) event.preventDefault();
  }
  function wheel(event) {
    const now = view.performance.now();
    if (now - lastWheel > quietMs) resetWheel();
    lastWheel = now;
    if (!eligible(event) || !event.cancelable) {
      locked = true;
      return;
    }
    const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? board.clientWidth
            : 1,
      dx = event.deltaX * unit,
      dy = event.deltaY * unit;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      locked = true;
      return;
    }
    const horizontal = Math.abs(dx) > Math.abs(dy) * dominance;
    if (locked) {
      if (consumed && horizontal) event.preventDefault();
      return;
    }
    distanceX += dx;
    absoluteX += Math.abs(dx);
    absoluteY += Math.abs(dy);
    if (axis === null && absoluteX + absoluteY >= 24) {
      axis = absoluteX > absoluteY * dominance ? "horizontal" : "native";
      if (axis === "native") locked = true;
    }
    if (axis !== "horizontal") return;
    if (!horizontal && Math.abs(dy) > 0) {
      locked = true;
      return;
    }
    if (Math.abs(distanceX) >= threshold) {
      locked = true;
      consumed = step(distanceX > 0 ? 1 : -1);
      if (consumed) event.preventDefault();
    }
  }
  function focusBoard(event) {
    const focusable = elementFor(event)?.closest(
      '[tabindex]:not([tabindex="-1"])',
    );
    if (
      event.button !== 0 ||
      !eligible(event, true) ||
      (focusable && focusable !== board)
    )
      return;
    board.focus({ preventScroll: true });
  }
  const startDrag = () => {
    dragging = true;
    locked = true;
  };
  const endDrag = () => {
    dragging = false;
  };
  board.addEventListener("keydown", keydown);
  board.addEventListener("wheel", wheel, { passive: false });
  board.addEventListener("pointerdown", focusBoard);
  doc.addEventListener("dragstart", startDrag);
  doc.addEventListener("dragend", endDrag);
  doc.addEventListener("drop", endDrag);
  view.addEventListener("blur", endDrag);
  return {
    destroy() {
      board.removeEventListener("keydown", keydown);
      board.removeEventListener("wheel", wheel);
      board.removeEventListener("pointerdown", focusBoard);
      doc.removeEventListener("dragstart", startDrag);
      doc.removeEventListener("dragend", endDrag);
      doc.removeEventListener("drop", endDrag);
      view.removeEventListener("blur", endDrag);
    },
  };
}
