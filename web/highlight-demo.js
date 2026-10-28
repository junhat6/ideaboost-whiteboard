// Synthetic, read-only comparison. Never imports the board model or an API adapter.
let mounted;
let stylePromise;
const choices = [
  {
    id: "halo",
    title: "A ふわっとハロー",
    detail: "やわらかな光が付箋全体を包みます。",
    timing: "1.5秒でゆっくり繰り返す",
  },
  {
    id: "pop",
    title: "B ぽんっとポップ",
    detail: "付箋の周りだけが、軽くひと呼吸。",
    timing: "0.65秒で1回・文字は動きません",
  },
  {
    id: "focus",
    title: "C すっとフォーカス",
    detail: "外から枠が集まり、付箋へ視線を誘導します。",
    timing: "0.7秒で1回・全辺が同時に収束",
  },
];
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
function styles() {
  if (!stylePromise) {
    stylePromise = new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("./highlight-demo.css", import.meta.url).href;
      link.id = "highlight-demo-styles";
      link.onload = resolve;
      link.onerror = () => {
        link.remove();
        stylePromise = undefined;
        reject(new Error("比較デモのスタイルを読み込めませんでした"));
      };
      document.head.append(link);
    });
  }
  return stylePromise;
}
function button(text, id) {
  const element = node("button", text);
  element.type = "button";
  if (id) element.id = id;
  return element;
}
export function mountHighlightDemo({ onClose } = {}) {
  if (mounted) return mounted;
  const dialog = node("dialog", undefined, "hd-dialog");
  dialog.id = "highlight-demo";
  dialog.setAttribute("aria-labelledby", "highlight-demo-heading");
  dialog.setAttribute("aria-describedby", "highlight-demo-notice");
  const header = node("header", undefined, "hd-header");
  const heading = node("h2", "未見積もりの強調を比べる");
  heading.id = "highlight-demo-heading";
  const closeButton = button("閉じる", "highlight-demo-close");
  header.append(heading, closeButton);
  const notice = node("p", "比較用・本番には反映されません", "hd-notice");
  notice.id = "highlight-demo-notice";
  const selector = node("div", undefined, "hd-choices");
  selector.setAttribute("role", "group");
  selector.setAttribute("aria-label", "強調の動きの比較候補");
  const choiceButtons = choices.map((choice) => {
    const control = button();
    control.dataset.demoChoice = choice.id;
    control.append(node("strong", choice.title), node("span", choice.timing));
    selector.append(control);
    return control;
  });
  const description = node("p", undefined, "hd-description");
  description.id = "highlight-demo-description";
  const controls = node("div", undefined, "hd-controls");
  const toggle = button("", "highlight-demo-toggle");
  toggle.setAttribute("aria-keyshortcuts", "U");
  const replay = button("もう一度再生", "highlight-demo-replay");
  const pause = button("一時停止", "highlight-demo-pause");
  controls.append(toggle, replay, pause);
  const stage = node("section", undefined, "hd-stage");
  stage.setAttribute("aria-label", "架空の付箋によるプレビュー");
  for (const [kind, label] of [
    ["task", "Task"],
    ["research", "調査"],
    ["unknown", "未設定タイプ"],
  ]) {
    const sample = node("figure", undefined, "hd-sample");
    const card = node("div", undefined, "hd-card");
    card.dataset.kind = kind;
    const plate = node("span", undefined, "hd-plate");
    plate.setAttribute("aria-hidden", "true");
    const paper = node("div", undefined, "hd-paper");
    const title = node(
      "h3",
      "利用者のアイデアを整理して、チームへ共有できる画面をつくる",
      "hd-title",
    );
    const footer = node("div", undefined, "hd-footer");
    // Inline shapes: no image request or data: URL, compatible with production CSP.
    const svg = (tag, attributes) => {
      const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [name, value] of Object.entries(attributes))
        shape.setAttribute(name, String(value));
      return shape;
    };
    const person = svg("svg", {
      class: "hd-avatar",
      width: 24,
      height: 24,
      viewBox: "0 0 24 24",
      role: "img",
      "aria-label": "担当者：デモ担当（架空）",
    });
    person.append(
      svg("rect", { width: 24, height: 24, rx: 12, fill: "#3159c9" }),
      svg("circle", { cx: 12, cy: 8, r: 4, fill: "#fff" }),
      svg("path", { d: "M4 23v-3a8 8 0 0 1 16 0v3", fill: "#fff" }),
    );
    const hours = node("span", "未見積", "hd-hours");
    hours.setAttribute("aria-label", "見積もり時間：未設定");
    footer.append(person, hours);
    paper.append(title, footer);
    card.append(plate, paper);
    sample.append(card, node("figcaption", label));
    stage.append(sample);
  }
  const status = node("p", undefined, "hd-status");
  status.setAttribute("role", "status");
  const hint = node(
    "p",
    "架空の同じ付箋で比較できます。U で強調を切り替え、Escape で閉じます。",
    "hd-hint",
  );
  const reduced = node(
    "p",
    "動きを減らす設定に合わせ、静止した強調で表示しています。",
    "hd-reduced",
  );
  dialog.append(
    header,
    notice,
    selector,
    description,
    controls,
    stage,
    status,
    hint,
    reduced,
  );
  document.body.append(dialog);
  let variant = "halo",
    enabled = true,
    paused = false,
    trigger = null,
    generation = 0,
    sessionOpen = false,
    composing = false;
  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const plate = entry.target.querySelector(".hd-plate");
      // Once per size change, not per animation frame. The border starts 8px outside.
      const width = plate.offsetWidth,
        height = plate.offsetHeight;
      if (width && height) {
        plate.style.setProperty("--hd-focus-x", String(1 + 16 / width));
        plate.style.setProperty("--hd-focus-y", String(1 + 16 / height));
      }
    }
  });
  function paint() {
    dialog.dataset.variant = variant;
    dialog.dataset.enabled = String(enabled);
    dialog.dataset.paused = String(paused);
    dialog.dataset.suspended = String(document.hidden);
    for (const control of choiceButtons)
      control.setAttribute(
        "aria-pressed",
        String(control.dataset.demoChoice === variant),
      );
    toggle.textContent = `強調 ${enabled ? "ON" : "OFF"}（U）`;
    toggle.setAttribute("aria-pressed", String(enabled));
    pause.textContent = paused ? "再開" : "一時停止";
    pause.setAttribute("aria-pressed", String(paused));
    replay.disabled = pause.disabled = !enabled;
    const choice = choices.find((item) => item.id === variant);
    description.textContent = choice.detail;
    status.textContent = `${choice.title} · ${!enabled ? "強調 OFF" : paused ? "一時停止中" : "強調 ON"}`;
  }
  function restart() {
    paused = false;
    paint();
    dialog.classList.remove("hd-playing");
    // Restart only on an explicit selection/replay/open. Never per-frame JS.
    void dialog.offsetWidth;
    if (dialog.open && enabled) dialog.classList.add("hd-playing");
  }
  function close() {
    generation++;
    if (dialog.open) dialog.close();
  }
  closeButton.onclick = close;
  choiceButtons.forEach((control) => {
    control.onclick = () => {
      variant = control.dataset.demoChoice;
      restart();
    };
  });
  toggle.onclick = () => {
    enabled = !enabled;
    restart();
  };
  replay.onclick = restart;
  pause.onclick = () => {
    paused = !paused;
    paint();
  };
  dialog.addEventListener("compositionstart", () => {
    composing = true;
  });
  dialog.addEventListener("compositionend", () => {
    composing = false;
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "u") return;
    event.stopPropagation();
    if (
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.isComposing ||
      composing ||
      event.target.closest?.(
        "input,textarea,select,[contenteditable],.cm-editor",
      ) ||
      document.activeElement?.closest?.(
        "input,textarea,select,[contenteditable],.cm-editor",
      )
    )
      return;
    event.preventDefault();
    toggle.click();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      close();
  });
  dialog.addEventListener("close", () => {
    // A queued close event must not tear down a later, already reopened dialog.
    if (dialog.open || !sessionOpen) return;
    sessionOpen = false;
    generation++;
    dialog.classList.remove("hd-playing");
    resize.disconnect();
    composing = paused = false;
    paint();
    onClose?.();
    if (trigger?.isConnected && trigger.getClientRects().length)
      trigger.focus();
    trigger = null;
  });
  document.addEventListener("visibilitychange", () => {
    if (dialog.open) paint();
  });
  paint();
  mounted = {
    async open(origin = document.activeElement) {
      const ticket = ++generation;
      await styles();
      if (ticket !== generation || document.querySelector("dialog[open]"))
        return;
      trigger = origin;
      dialog.showModal();
      sessionOpen = true;
      dialog
        .querySelectorAll(".hd-card")
        .forEach((card) => resize.observe(card));
      restart();
      closeButton.focus();
    },
    close,
    isOpen: () => dialog.open,
  };
  return mounted;
}
