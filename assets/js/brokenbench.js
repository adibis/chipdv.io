// brokenbench exercise page: editor, draft saving, tabs, and runs against the
// brokenbench runner. Pages served from localhost talk to a local runner, so
// the whole loop can be tested without the deployed service.
(function () {
  const data = JSON.parse(document.getElementById("bb-data").textContent);
  const root = document.querySelector(".bb");
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  const LOCAL_RUNNER = "http://127.0.0.1:8787";
  const override = new URLSearchParams(location.search).get("api");
  const draftKey = "bb:draft:" + data.slug;
  const trackId = (root.className.match(/\bbb-t-(\w+)/) || [])[1] || "";
  // Usage events for the site's analytics; a no-op when it isn't loaded.
  const event = (name, params) => {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, { exercise: data.slug, track: trackId, ...params });
    }
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } },
  };

  // Editor theme, remembered per browser
  const themeSelect = root.querySelector("[data-change=theme]");
  const setTheme = (t) => { root.dataset.theme = t; themeSelect.value = t; };
  setTheme(store.get("bb:theme") || "site");
  if (themeSelect.value === "") setTheme("site");
  themeSelect.addEventListener("change", () => { setTheme(themeSelect.value); store.set("bb:theme", themeSelect.value); });

  // Solved exercises, ticked in the exercise menu
  const solvedKey = "bb:solved";
  let solved;
  try { solved = new Set(JSON.parse(store.get(solvedKey) || "[]")); } catch (e) { solved = new Set(); }
  const markSolved = () => root.querySelectorAll(".bb-menu-list a[data-slug]").forEach((a) => {
    a.classList.toggle("bb-solved", solved.has(a.dataset.slug));
  });
  markSolved();
  const menu = root.querySelector(".bb-menu");
  document.addEventListener("click", (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") menu.open = false; });

  // A draft is stored with the starting code it was made from, so a later
  // change to the exercise is noticed rather than silently hidden. Drafts
  // from before that are plain strings that still carry the header comment
  // the brief now shows; it's dropped and the edits kept.
  const textarea = root.querySelector(".bb-editor textarea");
  let draft = null;
  const raw = store.get(draftKey);
  if (raw !== null) {
    try { draft = JSON.parse(raw); } catch (e) { draft = null; }
    if (!draft || typeof draft.code !== "string") {
      const lines = raw.split("\n");
      let i = 0;
      while (i < lines.length && (!lines[i].trim() || lines[i].trim().startsWith("//"))) i++;
      draft = { base: data.code, code: lines.slice(i).join("\n") };
    }
    textarea.value = draft.code;
  }
  let stale = !!draft && draft.base !== data.code && draft.code !== data.code;
  const editor = window.CodeMirror.fromTextArea(textarea, {
    mode: "text/x-systemverilog", lineNumbers: true, matchBrackets: true,
    indentUnit: 2, tabSize: 2, indentWithTabs: false, viewportMargin: Infinity,
    extraKeys: { "Ctrl-Enter": run, "Cmd-Enter": run, Tab: (cm) => cm.replaceSelection("  ") },
  });

  const savedNote = root.querySelector(".bb-saved");
  const showSaved = () => {
    savedNote.textContent = editor.getValue() === data.code ? "" :
      stale ? "draft from an older version of this exercise; Reset for the new one" : "draft saved in this browser";
  };
  let saveTimer;
  editor.on("change", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (editor.getValue() === data.code) store.del(draftKey);
      else store.set(draftKey, JSON.stringify({ base: stale ? draft.base : data.code, code: editor.getValue() }));
      showSaved();
    }, 400);
  });
  showSaved();

  // Tabs
  const tabs = root.querySelectorAll(".bb-tabs [role=tab]");
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((u) => u.setAttribute("aria-selected", u === t ? "true" : "false"));
    root.querySelectorAll(".bb-panel").forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
  }));

  // Code / Walk switch, on exercises that have walks
  const views = root.querySelectorAll(".bb-view [data-view]");
  views.forEach((v) => v.addEventListener("click", () => {
    const walk = v.dataset.view === "walk";
    views.forEach((u) => u.setAttribute("aria-pressed", u === v ? "true" : "false"));
    root.querySelector(".bb-walkview").hidden = !walk;
    if (walk) event("bb_walk");
    root.querySelector(".bb-editor").hidden = walk;
    if (!walk) editor.refresh();
  }));

  // Buttons
  const actions = {
    reset() {
      if (editor.getValue() !== data.code && !confirm("Throw away your changes and start from the original?")) return;
      stale = false;
      editor.setValue(data.code);
      store.del(draftKey);
    },
    reveal(btn) {
      event("bb_reveal_solution");
      btn.closest(".bb-reveal").hidden = true;
      root.querySelector(".bb-solution").hidden = false;
    },
    "load-solution"() {
      if (editor.getValue() !== data.code && !confirm("Replace your code with the solution? Your draft is overwritten.")) return;
      event("bb_load_solution");
      editor.setValue(data.solution);
    },
    "show-walk"() {
      root.querySelector("[data-view=walk]").click();
      if (window.innerWidth <= 900) root.querySelector(".bb-work").scrollIntoView({ behavior: "smooth" });
    },
    run,
  };
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn && actions[btn.dataset.action]) actions[btn.dataset.action](btn);
  });

  // Where runs build: the chipdv.io server, or a runner on the visitor's own
  // machine. Only probed once chosen, so no visitor is asked about local
  // network access unless they opt in.
  const whereSelect = root.querySelector("[data-change=where]");
  whereSelect.value = store.get("bb:where") === "local" ? "local" : "server";
  const onMachine = () => !override && whereSelect.value === "local";
  const api = () => override || (local || onMachine() ? LOCAL_RUNNER : data.api);
  const setup = root.querySelector(".bb-setup");
  const SETUP_TEXT = {
    missing: ["Run on your own machine",
      "No runner is answering on this computer yet. Start one with Docker, which brings Verilator and everything it needs:"],
    stale: ["Your runner is out of date",
      "It grades this exercise with a different checker than this page, so its results wouldn't match. Stop it with Ctrl-C and run the command again: it fetches the latest version first."],
  };
  let polling = null;

  // A local runner must grade with the same checker as this page, or its
  // verdict would be about a different exercise.
  async function probe() {
    try {
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 3000);
      const h = await (await fetch(LOCAL_RUNNER + "/health", { signal: ctl.signal })).json();
      return { state: (h.digests || {})[data.slug] === data.digest ? "ready" : "stale", h };
    } catch (e) {
      return { state: "missing" };
    }
  }

  function showSetup(state) {
    const [title, why] = SETUP_TEXT[state];
    setup.querySelector(".bb-setup-title").textContent = title;
    setup.querySelector(".bb-setup-why").textContent = why;
    setup.querySelector("[data-step=install]").hidden = state === "stale";
    setup.hidden = false;
    out.hidden = true;
    root.classList.add("bb-needs-setup");
    // Keep looking while the card is up, so starting the runner is all it takes.
    if (!polling) polling = setInterval(() => { if (!document.hidden) checkLocal(); }, 3000);
  }

  function hideSetup() {
    clearInterval(polling);
    polling = null;
    if (setup.hidden) return;
    setup.hidden = true;
    root.classList.remove("bb-needs-setup");
    editor.refresh();
  }

  let checking = null;
  function checkLocal() {
    return checking || (checking = (async () => {
      const { state, h } = await probe();
      checking = null;
      if (!onMachine()) return false;
      if (state !== "ready") {
        showSetup(state);
        return false;
      }
      const wasSetup = !setup.hidden;
      hideSetup();
      if (wasSetup || out.hidden) {
        show("busy", /^Verilator 5\.054 /.test(h.verilator || "")
          ? "Local runner ready: Verilator 5.054, exercises up to date."
          : `Local runner ready (${h.verilator}). The exercises were checked with Verilator 5.054; others may differ.`, "");
      }
      return true;
    })());
  }

  function setWhere(where) {
    whereSelect.value = where;
    store.set("bb:where", where);
    event("bb_where", { where });
    if (onMachine()) checkLocal();
    else { hideSetup(); out.hidden = true; }
  }
  whereSelect.addEventListener("change", () => setWhere(whereSelect.value));
  setup.querySelector("[data-action=use-server]").addEventListener("click", () => setWhere("server"));
  const copyBtn = setup.querySelector("[data-action=copy-setup]");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(setup.querySelector(".bb-setup-cmd code").textContent);
      copyBtn.textContent = "Copied";
    } catch (e) {
      copyBtn.textContent = "Select and copy";
    }
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
  });

  // Runs
  const runBtn = root.querySelector("[data-action=run]");
  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) runBtn.querySelector("kbd").textContent = "\u2318\u21b5";
  const out = root.querySelector(".bb-output");
  const status = out.querySelector(".bb-status");
  const log = out.querySelector("pre");
  const labels = { pass: "PASSED", fail: "FAILED", compile_error: "FAILED TO COMPILE", timeout: "STOPPED" };
  let busy = false;

  const progressEl = out.querySelector(".bb-progress");
  function show(kind, text, body) {
    out.hidden = false;
    out.dataset.kind = kind;
    progressEl.hidden = true;
    status.innerHTML = "";
    status.append(text);
    log.textContent = body || "";
  }

  const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const about = (s) => s < 60 ? `about ${s} s` : `about ${Math.round(s / 60)} min`;

  // What a run is doing, from the stages the runner reports as it goes. A
  // runner that doesn't report stages just gets the elapsed time.
  function tracker() {
    const t0 = Date.now();
    let cur = null, since = t0, queued = false;
    const render = () => {
      const now = Date.now();
      let text = "Compiling and running";
      let note = "";
      if (cur) {
        if (cur.stage === "queued") {
          text = `Waiting for a build slot · ${cur.ahead} ${cur.ahead === 1 ? "run" : "runs"} ahead of you`;
          note = "One build runs at a time. Unchanged starter code and solutions come back instantly.";
        } else if (cur.stage === "compiling") {
          text = cur.uvm ? "Compiling your code with the UVM library" : "Compiling your code";
        } else {
          text = "Simulating";
        }
        if (cur.stage !== "queued" && cur.usual) {
          note = now - since > cur.usual * 1000 * 1.25
            ? "Taking longer than usual. It's still going."
            : `This step usually takes ${about(cur.usual)}.`;
        }
      }
      show("busy", `${text} · ${clock(now - t0)}`, "");
      if (!cur) return;
      progressEl.hidden = false;
      const steps = [...(queued ? [["queued", "Wait for a slot"]] : []),
        ["compiling", "Compile"], ["simulating", "Simulate"]];
      const at = steps.findIndex(([k]) => k === cur.stage);
      progressEl.querySelector(".bb-steps").innerHTML = steps.map(([, label], i) =>
        `<li class="${i < at ? "is-done" : i === at ? "is-now" : ""}">${label}</li>`).join("");
      const meter = progressEl.querySelector(".bb-meter");
      const timed = cur.stage !== "queued" && cur.usual;
      meter.classList.toggle("is-unknown", cur.stage !== "queued" && !cur.usual);
      meter.hidden = cur.stage === "queued";
      meter.firstElementChild.style.width = timed
        ? `${Math.min(95, 100 * (now - since) / (cur.usual * 1000))}%` : "";
      progressEl.querySelector(".bb-progress-note").textContent = note;
    };
    const timer = setInterval(render, 1000);
    render();
    return {
      stage(msg) {
        if (msg.stage === "queued") queued = true;
        if (!cur || cur.stage !== msg.stage) since = Date.now();
        cur = msg;
        render();
      },
      stop() { clearInterval(timer); },
    };
  }

  // Reads a runner's stream: one JSON line per stage, then the result.
  async function readStream(r, onStage) {
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", result = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.stage) onStage(msg);
        else result = msg;
      }
    }
    return result;
  }

  async function run() {
    if (busy || runBtn.disabled) return;
    if (onMachine() && !(await checkLocal())) return;
    busy = true;
    runBtn.disabled = true;
    runBtn.classList.add("is-busy");
    const progress = tracker();
    try {
      const r = await fetch(api() + "/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/x-ndjson, application/json" },
        body: JSON.stringify({ slug: data.slug, code: editor.getValue() }),
      });
      let body;
      if (r.ok && (r.headers.get("Content-Type") || "").includes("ndjson")) {
        body = await readStream(r, progress.stage);
        if (!body) {
          progress.stop();
          event("bb_run", { status: "dropped" });
          return show("error", "The runner stopped answering before the result. Run again to retry.", "");
        }
      } else {
        body = await r.json();
      }
      progress.stop();
      if (!r.ok) {
        event("bb_run", { status: r.status === 429 ? "refused" : "error" });
        return show("error", body.error || `The runner answered ${r.status}.`, "");
      }
      event("bb_run", { status: body.status, seconds: body.seconds, cached: !!body.cached,
        where: onMachine() ? "local" : "server" });
      const head = document.createDocumentFragment();
      head.append(`${labels[body.status] || body.status} · ${body.cached ? "prebuilt result" : body.seconds + " s"}`);
      if (body.status === "pass") {
        if (!solved.has(data.slug)) event("bb_solved", { seconds: body.seconds });
        solved.add(data.slug);
        store.set(solvedKey, JSON.stringify([...solved]));
        markSolved();
      }
      if (body.status === "pass" && data.next) {
        const a = document.createElement("a");
        a.href = data.next;
        a.textContent = "Next exercise →";
        head.append(" ", a);
      }
      show(body.status, head, body.output);
    } catch (e) {
      progress.stop();
      event("bb_run", { status: "unreachable" });
      if (onMachine()) checkLocal();
      else show("error", `Can't reach the runner at ${api()}.`, "");
    } finally {
      busy = false;
      runBtn.disabled = false;
      runBtn.classList.remove("is-busy");
    }
  }

  // A visitor who chose their own machine last time sees straight away
  // whether its runner is up.
  if (onMachine()) checkLocal();
})();
