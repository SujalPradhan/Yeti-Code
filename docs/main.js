/*
 * yeti-code demo site
 *
 * Two interactions:
 *   1. Copy-to-clipboard on install command boxes.
 *   2. A looped, fake terminal session in the hero — types a real team-mode
 *      transcript so the visitor sees the streaming + tool-call + parallel
 *      worker UX in motion. Respects prefers-reduced-motion (renders the
 *      final frame statically instead).
 *
 * Vanilla JS. No deps. ~120 lines.
 */

(() => {
  // ── 1. Copy buttons ─────────────────────────────────────────────────────
  for (const btn of document.querySelectorAll(".copy-btn")) {
    btn.addEventListener("click", async () => {
      const targetId = btn.getAttribute("data-copy-target");
      const target = targetId && document.getElementById(targetId);
      if (!target) return;
      const text = (target.innerText || "").trim();
      try {
        await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = orig || "Copy";
          btn.classList.remove("copied");
        }, 1400);
      } catch {
        btn.textContent = "Press ⌘C";
        setTimeout(() => { btn.textContent = "Copy"; }, 1600);
      }
    });
  }

  // ── 2. Hero terminal animation ──────────────────────────────────────────
  const term = document.getElementById("terminal-body");
  if (!term) return;

  // Each script item paints one line. `type: "type"` is typed char-by-char
  // (used for the user's prompt + the leader's final synthesis to convey
  // streaming). `type: "line"` is shown instantly (used for system output
  // and tool-call lines). `type: "workers"` paints a live status block that
  // ticks each worker from ⏳ → ✓.
  const reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const SCRIPT = [
    { type: "line", cls: "t-dim",  text: "Type /help to see commands." },
    { type: "line", cls: "",       text: "" },
    { type: "type", cls: "t-user", prefix: "you → ",
      text: "I'm prepping for picoCTF. Decompose this into 4 parallel research tasks." },
    { type: "line", cls: "",       text: "" },
    { type: "line", cls: "t-team", text: "  🤝 Team mode — Leader: gemma4:e4b · Workers: gemma4:e4b" },
    { type: "line", cls: "",       text: "" },
    { type: "line", cls: "t-tool", text: "  🔧 delegate_tasks  4 tasks → [gemma4:e4b]" },
    { type: "line", cls: "",       text: "" },
    { type: "workers", workers: [
        { id: "t1", desc: "base64 patterns",    tokens: 142 },
        { id: "t2", desc: "hex / ascii",        tokens: 118 },
        { id: "t3", desc: "XOR crypto",         tokens: 156 },
        { id: "t4", desc: "forensics tools",    tokens: 134 },
    ]},
    { type: "line", cls: "t-bolt", text: "  ⚡ 4 workers in 1.5s  (cumulative 5.4s · 3.6× speedup)" },
    { type: "line", cls: "",       text: "" },
    { type: "type", cls: "t-team", prefix: "leader (gemma4:e4b) → ",
      text: "Study sheet ready. Base64 challenges typically use…" },
  ];

  // Static render path for reduced-motion users.
  if (reduceMotion) {
    const html = SCRIPT.map((s) => {
      if (s.type === "type")    return paintLine(s.cls, (s.prefix ?? "") + s.text);
      if (s.type === "line")    return paintLine(s.cls, s.text);
      if (s.type === "workers") return s.workers.map((w) =>
        paintLine("t-ok", `  ✓ ${w.id.padEnd(4)} [gemma4:e4b]  ${w.desc.padEnd(20)} · ${w.tokens} tokens · 1.${(w.tokens % 5) + 2}s`)
      ).join("\n");
      return "";
    }).join("\n");
    term.innerHTML = html;
    return;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeHtml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function paintLine(cls, text) {
    const safe = escapeHtml(text);
    return cls ? `<span class="${cls}">${safe}</span>` : safe;
  }

  let bufferHtml = "";

  function render(trailingCursor = false) {
    term.innerHTML = bufferHtml + (trailingCursor ? '<span class="t-cursor"></span>' : "");
  }

  async function typeLine(cls, prefix, text) {
    bufferHtml += paintLine(cls, prefix);
    render(true);
    for (const ch of text) {
      bufferHtml += paintLine(cls, ch);
      render(true);
      // Faster typing for the synthesis, normal pace for the user prompt
      const delay = cls === "t-team" ? 14 : 26;
      await sleep(delay + Math.random() * 18);
    }
    bufferHtml += "\n";
    render(false);
  }

  async function paintInstant(cls, text) {
    bufferHtml += paintLine(cls, text) + "\n";
    render(false);
    await sleep(180);
  }

  // ── Workers block: paint all four lines, then tick each one's token
  // counter, then mark each ✓ in roughly parallel timing.
  async function paintWorkers(workers) {
    const lines = workers.map((w) => ({ ...w, current: 0, done: false }));

    function renderBlock() {
      bufferHtml = bufferHtmlBase;
      for (const w of lines) {
        const head = w.done ? '<span class="t-ok">  ✓</span>' : '<span class="t-warn">  ⏳</span>';
        const status = w.done
          ? `<span class="t-dim"> · ${w.tokens} tokens · ${w.elapsed}ms</span>`
          : `<span class="t-dim"> · ${w.current} tokens…</span>`;
        bufferHtml +=
          `${head} <span class="t-team">${w.id.padEnd(4)}</span>` +
          ` <span class="t-dim">[gemma4:e4b]</span> ${escapeHtml(w.desc.padEnd(20))}${status}\n`;
      }
      render(false);
    }

    const bufferHtmlBase = bufferHtml;
    renderBlock();

    // 12 ticks total — workers ramp up token counts in parallel
    const totalTicks = 14;
    for (let tick = 0; tick < totalTicks; tick++) {
      for (const w of lines) {
        if (w.done) continue;
        w.current = Math.min(w.tokens, Math.floor((w.tokens * (tick + 1)) / totalTicks));
      }
      renderBlock();
      await sleep(90 + Math.random() * 40);
    }

    // Finish each worker in a tight stagger (parallel-ish)
    for (let i = 0; i < lines.length; i++) {
      lines[i].current = lines[i].tokens;
      lines[i].done = true;
      lines[i].elapsed = 1200 + Math.floor(Math.random() * 350);
      renderBlock();
      await sleep(110);
    }
    await sleep(200);
  }

  async function runOnce() {
    bufferHtml = "";
    render(true);
    await sleep(700);

    for (const item of SCRIPT) {
      if (item.type === "type") {
        await typeLine(item.cls, item.prefix ?? "", item.text);
        await sleep(280);
      } else if (item.type === "line") {
        await paintInstant(item.cls, item.text);
      } else if (item.type === "workers") {
        await paintWorkers(item.workers);
      }
    }

    await sleep(4200);
  }

  async function loop() {
    while (true) {
      try { await runOnce(); } catch { /* ignore visibility/blur errors */ }
    }
  }

  loop();
})();
