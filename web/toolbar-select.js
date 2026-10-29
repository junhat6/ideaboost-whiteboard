// Presentation-only enhancement. Native selects remain the source of values and
// change events; filtering, scope ownership and loading stay with the board.
export function enhanceToolbarSelects(selects) {
  const entries = [];
  let opened = null;
  const close = () => {
    if (!opened) return;
    opened.panel.hidden = true;
    opened.button.setAttribute("aria-expanded", "false");
    opened.button.removeAttribute("aria-activedescendant");
    opened.wrapper.dataset.open = "false";
    opened = null;
  };
  function hydrateAvatar(span) {
    if (!span.dataset.src || span.querySelector("img")) return;
    const img = document.createElement("img");
    img.src = span.dataset.src;
    img.alt = "";
    img.draggable = false;
    img.addEventListener(
      "error",
      () => {
        img.remove();
        delete span.dataset.src;
      },
      { once: true },
    );
    span.append(img);
  }
  function avatar(option, load = true) {
    if (!option?.dataset.login) return null;
    const span = document.createElement("span");
    span.className = "toolbar-select-avatar";
    span.setAttribute("aria-hidden", "true");
    span.textContent = option.dataset.login.slice(0, 1).toUpperCase();
    if (
      option.dataset.avatar?.startsWith(
        "https://avatars.githubusercontent.com/",
      )
    ) {
      span.dataset.src = option.dataset.avatar;
      if (load) hydrateAvatar(span);
    }
    return span;
  }
  for (const select of selects) {
    const wrapper = document.createElement("div");
    wrapper.className = "toolbar-select";
    select.before(wrapper);
    wrapper.append(select);
    select.classList.add("toolbar-select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    const button = document.createElement("button");
    button.id = select.id + "-trigger";
    button.type = "button";
    button.className = "toolbar-select-trigger";
    button.setAttribute("role", "combobox");
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", select.getAttribute("aria-label"));
    if (select.hasAttribute("aria-keyshortcuts"))
      button.setAttribute(
        "aria-keyshortcuts",
        select.getAttribute("aria-keyshortcuts"),
      );
    if (select.dataset.tooltip) button.dataset.tooltip = select.dataset.tooltip;
    const panel = document.createElement("div");
    panel.className = "toolbar-select-panel";
    panel.dataset.toolbarPopover = "true";
    panel.hidden = true;
    const caption = document.createElement("div");
    caption.className = "toolbar-select-caption";
    caption.textContent = select.getAttribute("aria-label");
    const list = document.createElement("div");
    list.id = select.id + "-options";
    list.className = "toolbar-select-options";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", select.getAttribute("aria-label"));
    button.setAttribute("aria-controls", list.id);
    panel.append(caption, list);
    wrapper.append(button, panel);
    const entry = {
      select,
      wrapper,
      button,
      panel,
      list,
      active: 0,
      signature: "",
    };
    entries.push(entry);
    function markActive(index) {
      const options = [...list.children];
      if (!options.length) return;
      const wanted = Math.max(0, Math.min(index, options.length - 1));
      const direction = wanted >= entry.active ? 1 : -1;
      let next = wanted;
      while (
        next >= 0 &&
        next < options.length &&
        select.options[next].disabled
      )
        next += direction;
      if (next < 0 || next >= options.length) {
        next = wanted;
        while (
          next >= 0 &&
          next < options.length &&
          select.options[next].disabled
        )
          next -= direction;
      }
      if (next < 0 || next >= options.length) {
        button.removeAttribute("aria-activedescendant");
        return;
      }
      entry.active = next;
      options.forEach((o, i) =>
        o.classList.toggle("is-active", i === entry.active),
      );
      button.setAttribute("aria-activedescendant", options[entry.active].id);
      options[entry.active].scrollIntoView({ block: "nearest" });
    }
    function choose(index) {
      const option = select.options[index];
      if (!option || option.disabled || select.disabled) return;
      const changed = select.value !== option.value;
      select.value = option.value;
      close();
      entry.sync();
      if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function open() {
      if (select.disabled || select.hidden) return;
      close();
      entry.sync();
      opened = entry;
      panel.hidden = false;
      list.querySelectorAll(".toolbar-select-avatar").forEach(hydrateAvatar);
      wrapper.dataset.open = "true";
      button.setAttribute("aria-expanded", "true");
      // The panel belongs to the toolbar focus subtree, not a body overlay.
      panel.style.left = "0px";
      const box = panel.getBoundingClientRect();
      if (box.right > window.innerWidth - 12)
        panel.style.left = `${window.innerWidth - 12 - box.right}px`;
      markActive(Math.max(0, select.selectedIndex));
    }
    entry.sync = () => {
      wrapper.hidden = select.hidden;
      button.disabled = select.disabled;
      if ((select.hidden || select.disabled) && opened === entry) close();
      const current = select.selectedOptions[0];
      button.replaceChildren();
      const picture = avatar(current);
      if (picture) button.append(picture);
      const label = document.createElement("span");
      label.className = "toolbar-select-value";
      label.textContent = current?.textContent || "選択してください";
      const chevron = document.createElement("span");
      chevron.className = "toolbar-select-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "⌄";
      button.append(label, chevron);
      const signature = [...select.options].map((o) => [
        o.value,
        o.textContent,
        o.disabled,
        o.dataset.avatar,
        o.dataset.login,
      ]);
      const key = JSON.stringify(signature);
      if (entry.signature !== key) {
        // A background refresh must not turn the highlighted index into a
        // different person/sprint underneath an imminent Enter press.
        if (opened === entry) close();
        entry.signature = key;
        list.replaceChildren();
        [...select.options].forEach((option, index) => {
          const row = document.createElement("div");
          row.id = list.id + "-" + index;
          row.className = "toolbar-select-option";
          row.setAttribute("role", "option");
          row.setAttribute("aria-disabled", String(option.disabled));
          const pic = avatar(option, false);
          if (pic) row.append(pic);
          else {
            const all = document.createElement("span");
            all.className = "toolbar-select-symbol";
            all.setAttribute("aria-hidden", "true");
            all.textContent = option.value ? "▦" : "◎";
            row.append(all);
          }
          const text = document.createElement("span");
          text.className = "toolbar-select-option-text";
          const name = document.createElement("span");
          name.textContent = option.textContent;
          text.append(name);
          if (
            option.dataset.login &&
            option.dataset.login !== option.textContent
          ) {
            const login = document.createElement("small");
            login.textContent = "@" + option.dataset.login;
            text.append(login);
          }
          const check = document.createElement("span");
          check.className = "toolbar-select-check";
          check.textContent = "✓";
          check.setAttribute("aria-hidden", "true");
          row.append(text, check);
          row.addEventListener("pointerdown", (e) => e.preventDefault());
          row.addEventListener("click", () => choose(index));
          list.append(row);
        });
      }
      [...list.children].forEach((row, index) =>
        row.setAttribute(
          "aria-selected",
          String(index === select.selectedIndex),
        ),
      );
      if (opened === entry) {
        list.querySelectorAll(".toolbar-select-avatar").forEach(hydrateAvatar);
        markActive(Math.min(entry.active, select.options.length - 1));
      }
    };
    button.addEventListener("click", () =>
      opened === entry ? close() : open(),
    );
    let typed = "",
      typedAt = 0;
    button.addEventListener("keydown", (e) => {
      if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape" && opened === entry) {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "Tab") {
        close();
        return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (opened !== entry) {
          open();
          if (e.key === "Home") markActive(0);
          else if (e.key === "End") markActive(select.options.length - 1);
          return;
        }
        markActive(
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? select.options.length - 1
              : entry.active + (e.key === "ArrowDown" ? 1 : -1),
        );
      } else if ((e.key === "Enter" || e.key === " ") && opened === entry) {
        e.preventDefault();
        e.stopPropagation();
        choose(entry.active);
      } else if (e.key.length === 1 && e.key.trim()) {
        e.preventDefault();
        e.stopPropagation();
        typed = Date.now() - typedAt > 700 ? e.key : typed + e.key;
        typedAt = Date.now();
        if (opened !== entry) open();
        const index = [...select.options].findIndex(
          (o) =>
            !o.disabled &&
            (o.textContent + " " + (o.dataset.login || ""))
              .toLocaleLowerCase()
              .startsWith(typed.toLocaleLowerCase()),
        );
        if (index >= 0) markActive(index);
      }
    });
    select.addEventListener("change", entry.sync);
    new MutationObserver(entry.sync).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "disabled"],
    });
    entry.sync();
  }
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (opened && !opened.wrapper.contains(e.target)) close();
    },
    true,
  );
  document.addEventListener("focusin", (e) => {
    if (opened && !opened.wrapper.contains(e.target)) close();
  });
  window.addEventListener("resize", close);
  return {
    close,
    sync: () => entries.forEach((e) => e.sync()),
    isOpen: () => !!opened,
  };
}
