"use strict";
/* Same-origin authenticated API only. Never accepts, persists, or exposes GitHub tokens. */
(() => {
  const messages = {
    sign_in_required: "許可されたチームアカウントでログインし直してください。",
    github_not_configured: "GitHub Appの接続設定がまだ完了していません。",
    github_auth_failed: "GitHub Appの認証を確認できません。",
    mutation_outcome_unresolved:
      "保存結果が未確定のため、このIssueの保存を停止しています。GitHubの状態を管理者が確認する必要があります。",
    request_already_processed:
      "この保存要求は処理済みです。最新を取得してから改めて編集してください。",
    mutation_queue_full:
      "保存要求が混み合っています。最新を取得し、時間をおいて操作してください。",
    mutation_ledger_capacity:
      "保存履歴が上限に達しました。管理者に確認してください。",
    conflict: "他の更新と競合しました。最新を取得してから編集してください。",
    issue_not_in_project_status:
      "Project外の親PBIのStatusはここでは変更できません。",
    assignee_not_assignable:
      "このリポジトリに割り当てできない担当者が含まれています。",
    invalid_private_key: "GitHub Appの接続設定を確認してください。",
  };
  let connecting = null,
    connected = false;
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(
        new URL(path.replace(/^\//, ""), new URL(".", location.href)),
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(45000),
          ...options,
          headers: { Accept: "application/json", ...options.headers },
        },
      );
    } catch {
      const e = new Error(
        options.method === "POST"
          ? "通信が途切れ、保存結果が不明です。再送せず「最新を取得」で確認してください。"
          : "GitHub連携サーバーに接続できません。表示内容は最新未確認です。",
      );
      e.ambiguous = options.method === "POST";
      throw e;
    }
    let data;
    try {
      data = await response.json();
    } catch {
      const e = new Error(
        "連携サーバーの応答を確認できません。最新を取得してください。",
      );
      e.ambiguous = options.method === "POST";
      throw e;
    }
    if (!response.ok || data.ok === false || data.partial || data.ambiguous) {
      const e = new Error(
        data.partial
          ? "一部の変更はGitHubに反映されています。元Issueを確認し、最新を取得してください。"
          : data.error === "mutation_outcome_unresolved"
            ? messages.mutation_outcome_unresolved
            : data.ambiguous
              ? "保存結果が不明です。再送せず、最新を取得してください。"
              : messages[data.error] ||
                `GitHub連携の処理を確認できません（${response.status}）。最新を取得してください。`,
      );
      e.code = response.status === 409 ? "CONFLICT" : data.error;
      e.partial = !!data.partial;
      e.ambiguous = !!data.ambiguous;
      e.latestBoard = data.board || null;
      e.latestIssue = data.issue || null;
      throw e;
    }
    return data;
  }
  window.Whiteboard.connectApi = async function (base = "") {
    if (base && new URL(base, location.href).origin !== location.origin)
      throw new Error("同じSite内の接続先のみ利用できます。");
    if (connected) return;
    if (connecting) return connecting;
    connecting = (async () => {
      const health = await request("/api/health");
      if (!health.configured) throw new Error(messages.github_not_configured);
      let latest = null,
        activeMilestone = "";
      await window.Whiteboard.setAdapter({
        label:
          health.accessMode === "public-temporary"
            ? "公開編集・GitHub接続済み"
            : "GitHub接続済み",
        async load(options) {
          let requestedMilestone = activeMilestone;
          if (options && Object.hasOwn(options, "milestone")) {
            const value = String(options.milestone ?? "");
            if (value && !/^[1-9]\d{0,8}$/.test(value))
              throw new Error("マイルストーンを確認してください。");
            requestedMilestone = value;
          }
          const loaded = await request(
            "/api/board" +
              (requestedMilestone ? "?milestone=" + requestedMilestone : ""),
          );
          activeMilestone = requestedMilestone;
          latest = loaded;
          return latest;
        },
        async saveIssue({ kind, id, patch, expectedRevision, expectedStatus }) {
          const old = (kind === "PBI" ? latest?.lanes : latest?.tasks)?.find(
            (i) => i.id === id,
          );
          if (
            !old ||
            !Number.isSafeInteger(old.number) ||
            old.number < 1 ||
            old.nodeId !== id
          )
            throw new Error("Issueを確認できません。最新を取得してください。");
          if (!expectedRevision || expectedRevision !== old.revision) {
            const e = new Error(
              "表示の版が変わりました。最新を取得してください。",
            );
            e.code = "CONFLICT";
            throw e;
          }
          const data = await request(`/api/issues/${old.number}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...patch,
              expectedRevision,
              expectedFingerprint: old.fingerprint,
              expectedStatus:
                expectedStatus === undefined
                  ? (old.status ?? null)
                  : expectedStatus,
              requestId: crypto.randomUUID(),
            }),
          });
          if (
            !data.issue ||
            data.issue.id !== id ||
            data.issue.number !== old.number
          ) {
            const e = new Error(
              "保存結果を確認できません。再送せず、最新を取得してください。",
            );
            e.ambiguous = true;
            throw e;
          }
          if (data.board) latest = data.board;
          return data.issue;
        },
      });
      connected = true;
      return true;
    })();
    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  };
  async function boot() {
    try {
      await window.Whiteboard.connectApi();
    } catch (e) {
      const note = document.querySelector("#scope-note");
      if (note) note.textContent = "GitHub未接続：" + e.message;
      window.Whiteboard.setConnectionError("接続できません：" + e.message);
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
