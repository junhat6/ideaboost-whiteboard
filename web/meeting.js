// 会議まとめ: 利用者が開いて「AIで整理」を押したときだけ、議事録・文字起こしを
// 決定・やること・未決・話題に分けて一枚で見せる。結果は保存せず、このタブの
// セッション中だけ同じ記録の再表示に使う (再整理は明示操作のみ)。
(() => {
  const $ = (s) => document.querySelector(s);
  const dialog = $("#meeting-dialog");
  const openButton = $("#meeting-open");
  if (!dialog || !openButton) return;
  const form = $("#meeting-form"),
    dateSelect = $("#meeting-date"),
    transcript = $("#meeting-transcript"),
    textarea = $("#meeting-text"),
    run = $("#meeting-run"),
    status = $("#meeting-status"),
    errorBox = $("#meeting-error"),
    result = $("#meeting-result");
  const MESSAGES = {
    meeting_ai_not_configured:
      "AI整理はまだ有効になっていません。管理者の設定をお待ちください。",
    meeting_logger_not_configured:
      "議事録リポジトリの読み取りは未承認です。いまは「貼り付け」で使えます。",
    meeting_source_unavailable:
      "議事録リポジトリを読めませんでした。権限または接続を確認してください。",
    meeting_not_found: "この日の議事録が見つかりません。",
    meeting_input_too_long:
      "記録が長すぎます（40万字まで）。文字起こしを外すか、分けて貼り付けてください。",
    meeting_digest_in_progress:
      "別の整理を実行中です。終わってからもう一度押してください。",
    meeting_ai_busy:
      "AIが混み合っています。少し待ってからもう一度押してください。",
    meeting_ai_incomplete:
      "AIの整理結果を受け取れませんでした。もう一度押すと整理し直します。",
    meeting_ai_failed: "AIの整理に失敗しました。もう一度押すと整理し直します。",
    not_found: "このモードでは会議まとめを使えません。",
    sign_in_required: "サインインが必要です。",
  };
  const STATE_LABEL = { decided: "結論あり", open: "未決", discussed: "共有" };
  const cache = new Map();
  let shownKey = null,
    capabilities = null,
    running = null,
    lastRequest = null,
    timer = null;

  function apiUrl(path) {
    return new URL(path, new URL(".", location.href));
  }
  async function call(path, options = {}) {
    let response;
    try {
      response = await fetch(apiUrl(path), {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeout || 20000),
        ...options,
        headers: { Accept: "application/json", ...options.headers },
      });
    } catch (cause) {
      const e = new Error(
        cause?.name === "TimeoutError"
          ? "応答が制限時間内に届きませんでした。もう一度押すと整理し直します。"
          : "通信が途切れました。もう一度押すと整理し直します。",
      );
      throw e;
    }
    let data = null;
    try {
      data = await response.json();
    } catch {}
    if (!response.ok || !data || data.ok === false) {
      const code = data?.error;
      throw Object.assign(
        new Error(MESSAGES[code] || "会議まとめを利用できませんでした。"),
        { code },
      );
    }
    return data;
  }

  const source = () =>
    form.querySelector('input[name="meeting-source"]:checked')?.value ||
    "logger";
  function syncForm() {
    const paste = source() === "paste";
    textarea.hidden = !paste;
    dateSelect.hidden = paste;
    transcript.closest("label").hidden = paste;
    run.disabled =
      !!running ||
      !capabilities?.ai ||
      (paste ? !textarea.value.trim() : !dateSelect.value);
  }
  // 選んだ記録に合う結果だけを見せる。別の日の結果を残したままにしない。
  function showSelected() {
    if (running) return;
    const key = cacheKey();
    if (key === shownKey) return;
    errorBox.hidden = true;
    if (key && cache.has(key)) render(cache.get(key), true, key);
    else if (shownKey !== null || key !== null) {
      result.replaceChildren();
      shownKey = null;
    }
  }
  form.addEventListener("change", (e) => {
    syncForm();
    if (e.target !== textarea) showSelected();
  });
  textarea.addEventListener("input", syncForm);

  async function loadCapabilities() {
    if (capabilities) return capabilities;
    status.textContent = "会議の一覧を確認しています…";
    try {
      capabilities = await call("api/meetings");
    } catch (error) {
      status.textContent = "";
      showError(error.message, false);
      return null;
    }
    dateSelect.replaceChildren(
      ...capabilities.meetings.map((m) => {
        const o = document.createElement("option");
        o.value = m.date;
        o.textContent = m.date;
        return o;
      }),
    );
    const loggerRadio = form.querySelector('input[value="logger"]');
    if (!capabilities.logger || !capabilities.meetings.length) {
      loggerRadio.disabled = true;
      form.querySelector('input[value="paste"]').checked = true;
    }
    status.textContent = !capabilities.ai
      ? MESSAGES.meeting_ai_not_configured
      : !capabilities.logger
        ? "議事録リポジトリは未接続です。議事録や文字起こしを貼り付けて整理できます。"
        : "";
    return capabilities;
  }

  function open() {
    if (document.querySelector("dialog[open]")) return;
    dialog.showModal();
    syncForm();
    loadCapabilities().then(() => {
      syncForm();
      if (!result.childElementCount) showSelected();
      (source() === "paste" ? textarea : dateSelect).focus();
    });
  }
  // 閉じた後のフォーカスはネイティブ dialog が起点へ戻す (PBIを開く時に奪わない)。
  openButton.addEventListener("click", open);
  document.addEventListener("keydown", (e) => {
    if (
      e.key !== "m" ||
      e.repeat ||
      e.isComposing ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.shiftKey ||
      document.querySelector("dialog[open]") ||
      openButton.hidden
    )
      return;
    const writing = (node) =>
      node?.closest?.(
        "input,textarea,select,[role=combobox],[contenteditable],.cm-editor",
      );
    if (writing(e.target) || writing(document.activeElement)) return;
    e.preventDefault();
    open();
  });
  new MutationObserver(() => {
    openButton.hidden =
      document.documentElement.dataset.accessMode === "public-temporary";
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-access-mode"],
  });

  function cacheKey() {
    if (source() === "paste") return null;
    return dateSelect.value
      ? `${dateSelect.value}|${transcript.checked ? "t" : "m"}`
      : null;
  }
  function pbis() {
    const lanes = window.Whiteboard?.getSnapshot?.().lanes || [];
    return lanes
      .filter((l) => Number.isInteger(l.number))
      .slice(0, 80)
      .map((l) => ({ number: l.number, title: String(l.title || "") }));
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    start();
  });
  $("#meeting-retry").addEventListener("click", () => {
    if (lastRequest) start(lastRequest);
  });

  async function start(request) {
    if (running || !capabilities?.ai) return;
    const body = request || {
      ...(source() === "paste"
        ? { text: textarea.value }
        : { date: dateSelect.value, transcript: transcript.checked }),
      pbis: pbis(),
    };
    const key = body.date
      ? `${body.date}|${body.transcript ? "t" : "m"}`
      : null;
    lastRequest = body;
    errorBox.hidden = true;
    result.replaceChildren();
    result.setAttribute("aria-busy", "true");
    const began = Date.now();
    const tick = () => {
      const s = Math.round((Date.now() - began) / 1000);
      status.textContent =
        `AIが整理しています… ${s}秒` +
        (s >= 7
          ? body.transcript
            ? "（文字起こし込みは1〜2分かかることがあります）"
            : "（応答を待っています）"
          : "");
    };
    tick();
    timer = setInterval(tick, 1000);
    running = call("api/meetings/digest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      timeout: 180000,
    });
    syncForm();
    try {
      const data = await running;
      if (key) cache.set(key, data);
      status.textContent = "";
      render(data, false, key);
    } catch (error) {
      status.textContent = "";
      // 読み取り専用なので再実行は安全だが、費用がかかるため自動では送らない。
      showError(error.message, true);
    } finally {
      clearInterval(timer);
      running = null;
      result.setAttribute("aria-busy", "false");
      syncForm();
    }
  }

  function showError(message, retry) {
    errorBox.hidden = false;
    errorBox.querySelector("p").textContent = message;
    $("#meeting-retry").hidden = !retry;
  }

  // ---- 描画 (textContent のみ。AI出力を HTML として解釈しない) ----
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const safeUrl = (u) =>
    typeof u === "string" && u.startsWith("https://github.com/") ? u : null;
  function link(href, text, className = "") {
    const a = el("a", className, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  function evidence(list) {
    const wrap = el("span", "meeting-evidence");
    for (const e of list || []) {
      const href = safeUrl(e.url);
      if (!href) continue;
      const a = link(href, e.from || "原文", "meeting-time");
      a.setAttribute("aria-label", `文字起こし ${e.from}〜${e.to} を開く`);
      wrap.append(a);
    }
    return wrap.childElementCount ? wrap : null;
  }
  function pbiChips(numbers) {
    const lanes = new Map(
      (window.Whiteboard?.getSnapshot?.().lanes || []).map((l) => [
        l.number,
        l,
      ]),
    );
    const wrap = el("span", "meeting-pbis");
    for (const n of numbers || []) {
      const lane = lanes.get(n);
      const b = el("button", "meeting-pbi", `#${n}`);
      b.type = "button";
      b.dataset.pbi = String(n);
      b.setAttribute(
        "aria-label",
        `PBI #${n} ${lane?.title || ""} をボードで開く`,
      );
      b.title = lane?.title || "";
      wrap.append(b);
    }
    return wrap.childElementCount ? wrap : null;
  }
  function topicRef(digest, index) {
    if (index < 0 || !digest.topics[index]) return null;
    const b = el("button", "meeting-topic-ref", digest.topics[index].title);
    b.type = "button";
    b.dataset.goTopic = String(index);
    return b;
  }
  function column(title, kind, items, renderItem, empty) {
    const section = el("section", `meeting-col meeting-col-${kind}`);
    const h = el("h4", "", title);
    h.append(el("span", "meeting-count", String(items.length)));
    section.append(h);
    if (!items.length) section.append(el("p", "meeting-empty", empty));
    else {
      const ul = el("ul");
      for (const item of items) {
        const li = el("li");
        if (item.topic >= 0) li.dataset.topic = String(item.topic);
        renderItem(li, item);
        ul.append(li);
      }
      section.append(ul);
    }
    return section;
  }
  function meta(li, ...nodes) {
    const row = el("span", "meeting-meta");
    for (const n of nodes) if (n) row.append(n);
    if (row.childElementCount) li.append(row);
  }

  function render(data, fromCache, key = null) {
    shownKey = key;
    const { digest, source: src } = data;
    errorBox.hidden = true;
    const head = el("header", "meeting-head");
    const kicker = el(
      "p",
      "meeting-kicker",
      [
        src.date || "貼り付けた記録",
        src.transcripts?.length ? "議事録＋文字起こし" : "議事録",
        "AIによる整理",
      ].join(" · "),
    );
    head.append(kicker, el("h3", "meeting-headline", digest.headline));
    if (digest.overview)
      head.append(el("p", "meeting-overview", digest.overview));
    const links = el("div", "meeting-links");
    if (safeUrl(src.minutesUrl))
      links.append(link(src.minutesUrl, "議事録の原文 ↗"));
    for (const t of src.transcripts || [])
      if (safeUrl(t.url))
        links.append(
          link(t.url, `文字起こし（${t.half === "am" ? "午前" : "午後"}）↗`),
        );
    const copy = el("button", "quiet-button", "Markdownでコピー");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(toMarkdown(data));
        copy.textContent = "コピーしました";
      } catch {
        copy.textContent = "コピーできませんでした";
      }
      setTimeout(() => (copy.textContent = "Markdownでコピー"), 2000);
    });
    links.append(copy);
    head.append(links);

    const columns = el("div", "meeting-columns");
    columns.append(
      column(
        "決まったこと",
        "decided",
        digest.decisions,
        (li, d) => {
          li.append(el("span", "meeting-text", d.text));
          meta(
            li,
            d.needsConfirmation ? el("span", "meeting-flag", "要確認") : null,
            topicRef(digest, d.topic),
            evidence(d.evidence),
          );
        },
        "決まったことは記録にありません。",
      ),
      column(
        "次にやること",
        "actions",
        digest.actions,
        (li, a) => {
          li.append(el("span", "meeting-text", a.text));
          meta(
            li,
            el(
              "span",
              a.owner ? "meeting-owner" : "meeting-owner unassigned",
              a.owner ? a.owner : "担当未定",
            ),
            a.due ? el("span", "meeting-due", a.due) : null,
            pbiChips(a.pbis),
            topicRef(digest, a.topic),
            evidence(a.evidence),
          );
        },
        "やることは記録にありません。",
      ),
      column(
        "未決・持ち越し",
        "open",
        digest.openQuestions,
        (li, q) => {
          li.append(el("span", "meeting-text", q.text));
          meta(li, topicRef(digest, q.topic), evidence(q.evidence));
        },
        "未決の事項は記録にありません。",
      ),
    );

    const parts = [head, columns];
    if (digest.timeline.length) {
      const tl = el("section", "meeting-timeline");
      tl.append(el("h4", "", "会議の流れ"));
      const ol = el("ol");
      for (const t of digest.timeline) {
        const li = el("li");
        const href = safeUrl(t.url);
        const time = href
          ? link(href, t.from, "meeting-time")
          : el("span", "meeting-time", t.from);
        li.append(time, el("span", "meeting-text", t.label));
        ol.append(li);
      }
      tl.append(ol);
      parts.push(tl);
    }
    const topics = el("section", "meeting-topics");
    topics.append(el("h4", "", "話題"));
    const grid = el("div", "meeting-topic-grid");
    digest.topics.forEach((t, i) => {
      const card = el("article", "meeting-topic");
      card.dataset.state = t.state;
      card.dataset.topicIndex = String(i);
      card.tabIndex = -1;
      card.id = `meeting-topic-${i}`;
      const top = el("div", "meeting-topic-top");
      top.append(
        el(
          "span",
          `meeting-state meeting-state-${t.state}`,
          STATE_LABEL[t.state],
        ),
        el("h5", "", t.title),
      );
      card.append(top);
      if (t.summary) card.append(el("p", "meeting-summary", t.summary));
      if (t.points.length) {
        const ul = el("ul");
        for (const p of t.points) ul.append(el("li", "", p));
        card.append(ul);
      }
      const foot = el("div", "meeting-meta");
      const chips = pbiChips(t.pbis),
        ev = evidence(t.evidence);
      if (chips) foot.append(chips);
      if (ev) foot.append(ev);
      if (foot.childElementCount) card.append(foot);
      grid.append(card);
    });
    topics.append(grid);
    parts.push(topics);
    const foot = el(
      "p",
      "meeting-foot",
      `AIが記録から整理した内容です。担当・期限・決定は原文で確認してください。` +
        ` ${data.model || ""} · ${new Date(data.generatedAt).toLocaleString("ja-JP")}` +
        (fromCache ? "（このタブで整理済みの結果）" : ""),
    );
    parts.push(foot);
    if (fromCache) {
      const again = el("button", "quiet-button", "もう一度整理する");
      again.type = "button";
      again.addEventListener("click", () => start());
      foot.append(" ", again);
    }
    result.replaceChildren(...parts);
    result.scrollTop = 0;
  }

  // 話題とその決定・やること・未決を相互に強調し、どこから出た話かを辿れるようにする。
  function highlight(index) {
    result
      .querySelectorAll(".is-related")
      .forEach((n) => n.classList.remove("is-related"));
    if (index === null) return;
    result
      .querySelectorAll(
        `[data-topic="${index}"], [data-topic-index="${index}"]`,
      )
      .forEach((n) => n.classList.add("is-related"));
  }
  const topicOf = (node) => {
    const holder = node?.closest?.("[data-topic], [data-topic-index]");
    if (!holder) return null;
    return holder.dataset.topic ?? holder.dataset.topicIndex;
  };
  result.addEventListener("pointerover", (e) => highlight(topicOf(e.target)));
  result.addEventListener("pointerleave", () => highlight(null));
  result.addEventListener("focusin", (e) => highlight(topicOf(e.target)));
  result.addEventListener("click", (e) => {
    const pbi = e.target.closest?.("[data-pbi]");
    if (pbi) {
      dialog.close();
      if (!window.Whiteboard?.openPbi?.(Number(pbi.dataset.pbi))) {
        const toast = $("#announcement");
        if (toast)
          toast.textContent = `PBI #${pbi.dataset.pbi} は現在のボードに表示されていません。`;
      }
      return;
    }
    const go = e.target.closest?.("[data-go-topic]");
    if (go) {
      const card = $(`#meeting-topic-${go.dataset.goTopic}`);
      card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      card?.focus({ preventScroll: true });
      highlight(go.dataset.goTopic);
    }
  });

  function toMarkdown({ digest, source: src }) {
    const lines = [`# ${digest.headline}`, ""];
    if (src.date) lines.push(`${src.date}（AIによる整理）`, "");
    if (digest.overview) lines.push(digest.overview, "");
    const section = (title, items, fmt) => {
      if (!items.length) return;
      lines.push(`## ${title}`, "", ...items.map((i) => `- ${fmt(i)}`), "");
    };
    section("決まったこと", digest.decisions, (d) =>
      d.needsConfirmation ? `${d.text}（要確認）` : d.text,
    );
    section("次にやること", digest.actions, (a) =>
      [
        a.text,
        a.owner ? `担当: ${a.owner}` : "担当未定",
        a.due ? `期限: ${a.due}` : "",
        ...a.pbis.map((n) => `#${n}`),
      ]
        .filter(Boolean)
        .join(" / "),
    );
    section("未決・持ち越し", digest.openQuestions, (q) => q.text);
    section(
      "話題",
      digest.topics,
      (t) => `${t.title}（${STATE_LABEL[t.state]}）: ${t.summary}`,
    );
    if (src.minutesUrl) lines.push(`原文: ${src.minutesUrl}`);
    return lines.join("\n");
  }
})();
