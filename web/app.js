// Timeline desk. All Timeline text is inserted with textContent, never as HTML.
"use strict";

const STAGES = ["RSD", "Estimate", "Development", "Testing", "QA", "Live"];
const STAGE_SHORT = ["RSD", "Est", "Dev", "Test", "QA", "Live"];

const view = document.getElementById("view");
const meta = document.getElementById("meta");
const cache = { planner: null, statuses: new Map(), boards: null };

// ---- helpers --------------------------------------------------------------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// replaceChildren, skipping null/false like h() does.
function put(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false)
    .map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
}

async function api(path, options) {
  const response = await fetch(path, options);
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw new Error(body.error || `Request failed (HTTP ${response.status}).`);
  return body;
}

function niceDate(iso, withWeekday = true) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", withWeekday
    ? { weekday: "short", day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" });
}

// Timeline rich text arrives as HTML. Parse it in an inert document and keep
// only the text, with line breaks where blocks ended.
function plainText(html) {
  if (!html) return "";
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

// A small, safe subset of markdown, built as DOM nodes: headings, list items,
// **bold**, *italic*, `code`, and images/links as plain links to absolute URLs.
function absolute(url) {
  try { return new URL(url, "https://timeline.panteon.no").href; } catch { return null; }
}

function inline(text) {
  const out = [];
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    out.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    const href = absolute(m[2] || m[4] || "");
    if (m[2] !== undefined || m[4] !== undefined) {
      const label = m[2] !== undefined ? `[image${m[1] ? `: ${m[1]}` : ""}]` : m[3];
      out.push(href && /^https?:/.test(href)
        ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, label)
        : label);
    } else if (m[5] !== undefined) out.push(h("strong", {}, m[5]));
    else if (m[6] !== undefined) out.push(h("em", {}, m[6]));
    else out.push(h("code", {}, m[7]));
  }
  out.push(text.slice(last));
  return out;
}

function richText(source) {
  const text = plainText(source);
  const root = h("div", { class: "body rich" });
  for (const line of text.split("\n")) {
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    const item = line.match(/^\s*([-*]|\d+[.)])\s+(.*)$/);
    if (heading) root.append(h("strong", { class: "md-h" }, inline(heading[2])));
    else if (item) root.append(h("div", { class: "md-li" }, `${/\d/.test(item[1]) ? item[1] : "•"} `, inline(item[2])));
    else root.append(h("div", {}, line ? inline(line) : "\u00a0"));
  }
  return root;
}

function showError(error) {
  put(view, h("p", { class: "error", role: "alert" }, error.message || String(error)));
}

function loading(text) {
  put(view, h("p", { class: "note" }, text));
}

// ---- stage rail -----------------------------------------------------------
function rail(status) {
  const known = status && !status.error;
  const label = known
    ? STAGES.map((s) => `${s}: ${status.stages[s]}`).join(", ")
    : "Stage progress loading";
  return h("div", { class: `rail${known ? "" : " pending"}`, role: "img", "aria-label": label, title: label },
    STAGES.map((s) => h("span", { "data-p": known ? status.stages[s] : null })));
}

function railKey() {
  return h("div", { class: "rail-key", "aria-hidden": "true" }, STAGE_SHORT.map((s) => h("span", {}, s)));
}

function legend() {
  const item = (p, text) => h("span", {}, h("i", { style: swatch(p) }), text);
  return h("p", { class: "legend" },
    item("done", "Done"), item("in progress", "In progress"), item("blocked", "Blocked"),
    item("skipped", "Skipped"), item(null, "Not started"));
}

function swatch(p) {
  const color = { done: "var(--done)", "in progress": "var(--progress)", blocked: "var(--blocked)" }[p];
  if (color) return `background:${color};border-color:${color}`;
  if (p === "skipped") return "background:repeating-linear-gradient(135deg,var(--skipped) 0 2px,transparent 2px 5px);border-color:var(--skipped)";
  return "";
}

async function loadStatuses(ids) {
  const missing = ids.filter((id) => !cache.statuses.has(String(id)));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const { statuses } = await api(`/api/statuses?ids=${encodeURIComponent(batch.join(","))}`);
    for (const s of statuses) cache.statuses.set(String(s.issue_id), s);
  }
  return ids.map((id) => cache.statuses.get(String(id)));
}

// Replace placeholder rails once stage codes arrive.
async function fillRails(root) {
  const holders = [...root.querySelectorAll("[data-rail]")];
  if (!holders.length) return;
  try {
    await loadStatuses([...new Set(holders.map((el) => el.dataset.rail))]);
  } catch {
    return; // Rails stay dashed; the rest of the view still works.
  }
  for (const holder of holders) {
    const fresh = rail(cache.statuses.get(holder.dataset.rail));
    fresh.classList.add("lit");
    holder.querySelector(".rail").replaceWith(fresh);
  }
}

// ---- board ----------------------------------------------------------------
async function getPlanner(force) {
  if (!cache.planner || force) cache.planner = await api("/api/planner");
  const p = cache.planner;
  const now = p.periods.now.tasks.length;
  meta.textContent = `User ${p.user_id} · ${niceDate(p.today)} · ${now} task${now === 1 ? "" : "s"} now`;
  return p;
}

function flagBadge(flag) {
  if (!flag) return null;
  return h("span", { class: `badge ${flag === "overdue" ? "overdue" : "soon"}` }, flag);
}

function taskCard(task, boards) {
  const start = startButton(task.issue_number, task.code, boards, true, task.stage_status);
  const card = h("a", { class: "card", href: `#/task/${task.issue_number}`, "data-rail": task.issue_number },
    h("div", { class: "head" },
      h("span", { class: "issue" }, `#${task.issue_number}`),
      flagBadge(task.deadline_flag),
      task.support ? h("span", { class: "badge support" }, "support") : null),
    h("p", { class: "title" }, task.title),
    rail(null),
    h("div", { class: "foot" },
      h("span", { class: "stage" }, task.stage_status || "No stage"),
      h("span", {}, task.deadline ? niceDate(task.deadline) : "No deadline")));
  return start ? h("div", { class: "card-wrap" }, card, start) : card;
}

async function showBoard(force) {
  loading("Loading your planner…");
  const [p, boards] = await Promise.all([getPlanner(force), getBoards()]);
  const columns = Object.entries(p.periods).map(([key, period]) => {
    const overdue = period.tasks.filter((t) => t.deadline_flag === "overdue").length;
    return h("section", { class: "column", "aria-labelledby": `col-${key}` },
      h("h2", { id: `col-${key}` }, period.label,
        h("span", { class: "count" }, period.tasks.length),
        overdue ? h("span", { class: "warn" }, `${overdue} overdue`) : null),
      railKey(),
      period.tasks.length
        ? period.tasks.map((t) => taskCard(t, boards))
        : h("p", { class: "note" }, "Nothing planned here."));
  });
  put(view, legend(), h("div", { class: "board" }, columns));
  fillRails(view);
}

// ---- changes --------------------------------------------------------------
const CHANGE_GROUPS = [
  ["added", "New", (t) => `${t.period} · ${t.stage_status || "no stage"}`],
  ["removed", "Left the planner", (t) => `was in ${t.period}`],
  ["moved", "Moved", (t) => `${t.from} → ${t.to}`],
  ["changed", "Changed", (t) => t.changes.map(([name, a, b]) => `${name}: ${a || "—"} → ${b || "—"}`).join("; ")],
];

function changeItem(task, detail) {
  return h("li", {},
    h("a", { href: `#/task/${task.issue_number}` }, h("span", { class: "issue" }, `#${task.issue_number}`)),
    " ", task.title || "", " ",
    h("span", { class: "detail" }, `— ${detail(task)}`));
}

async function showChanges() {
  loading("Loading planner history…");
  const history = await api("/api/changes");
  const save = h("button", { type: "button", class: "btn", onclick: saveSnapshot }, "Save today's snapshot");
  const status = h("span", { class: "note", id: "snapshot-status" });
  const days = history.days.map((day) => {
    const groups = CHANGE_GROUPS
      .filter(([key]) => day.diff[key].length)
      .map(([key, title, detail]) => h("ul", { class: `change ${key}` },
        h("h3", {}, `${title} (${day.diff[key].length})`),
        day.diff[key].map((t) => changeItem(t, detail))));
    return h("section", { class: "day" },
      h("h2", {}, niceDate(day.date), h("small", {}, `since ${niceDate(day.previous_date)}`)),
      groups.length ? groups : h("p", { class: "note" }, "No changes."));
  });
  let intro;
  if (!history.first_date) intro = "No snapshots yet. Save today's snapshot to start tracking.";
  else if (!days.length) intro = `Tracking started ${niceDate(history.first_date)}. Changes appear after the next day's snapshot.`;
  put(view, 
    h("div", { class: "toolbar" }, save, status),
    intro ? h("p", { class: "note" }, intro) : null,
    days);
}

async function saveSnapshot(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api("/api/snapshot", { method: "POST", headers: { "X-Timeline-Desk": "1" } });
    await showChanges();
    document.getElementById("snapshot-status").textContent =
      `Saved ${niceDate(result.date)} (${result.tasks} tasks).`;
  } catch (error) {
    button.disabled = false;
    document.getElementById("snapshot-status").textContent = error.message;
  }
}

// ---- release --------------------------------------------------------------
// Pending duell-admin PRs, grouped by the branch they merge into.
const VERDICT_CLASS = { ready: "ok", "needs notes": "soon", blocked: "overdue" };

function parseIds(text) {
  return [...new Set((text.match(/\/edit\/(\d+)|\b\d{2,}\b/g) || []).map((m) => m.replace("/edit/", "")))];
}

function clock(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function prCard(pr) {
  const checks = pr.checks;
  const ci = checks.failed.length ? `CI failing: ${checks.failed.join(", ")}`
    : checks.pending.length ? "CI running"
    : checks.total ? "CI passed" : "No CI";
  const notes = [...pr.problems];
  if (pr.base === "master" && pr.via_qa === "no") notes.unshift("Direct to master, not via QA");
  if (pr.base === "master" && pr.via_qa === "partly") {
    const n = pr.commits_not_on_qa;
    notes.unshift(n ? `${n} commit${n === 1 ? "" : "s"} not on qa-release yet` : "Latest commits aren't on qa-release");
  }
  if (pr.verdict === "blocked") notes.unshift(pr.reason);
  const stage = pr.status && !pr.status.error ? pr.status.stage_status : null;
  return h("article", { class: "card pr" },
    h("div", { class: "head" },
      h("a", { href: pr.url, target: "_blank", rel: "noopener noreferrer", class: "issue" }, `PR ${pr.number} ↗`),
      pr.issue_id ? h("a", { href: `#/task/${pr.issue_id}`, class: "issue" }, `#${pr.issue_id}`) : h("span", { class: "badge" }, "hotfix"),
      h("span", { class: `badge ${VERDICT_CLASS[pr.verdict]}` }, pr.verdict)),
    h("p", { class: "title" }, pr.title),
    h("p", { class: "stage" },
      [`@${pr.author}`, `${pr.age_days ?? "?"}d`, ci, stage && `Timeline: ${stage}`].filter(Boolean).join(" · ")),
    notes.length ? h("ul", { class: "problems" }, notes.map((n) => h("li", {}, n))) : null,
    pr.body ? h("pre", { class: "body pr-body" }, pr.body) : h("p", { class: "note" }, "No description."));
}

function renderPrs(report, results) {
  put(results, h("div", { class: "pr-columns" }, ["qa-release", "master"].map((base) => {
    const prs = report.prs[base];
    return h("section", { class: "lane" },
      h("h2", {}, `Into ${base}`, h("span", { class: "count" }, prs.length)),
      prs.length ? prs.map(prCard) : h("p", { class: "note" }, "No pending PRs."));
  })));
}

async function checkRelease(results, stamp, button, fetchFresh) {
  button.disabled = true;
  stamp.textContent = fetchFresh ? "Fetching from GitHub… (about 10 s)" : "Loading…";
  try {
    let { report } = await api("/api/release");
    if (!report || fetchFresh) {
      ({ report } = await api("/api/release", { method: "POST", headers: { "X-Timeline-Desk": "1" } }));
    }
    renderPrs(report, results);
    stamp.textContent = `Checked at ${clock(report.generated_at)}`;
  } catch (error) {
    stamp.textContent = "";
    put(results, h("p", { class: "error", role: "alert" }, error.message));
  } finally {
    button.disabled = false;
  }
}

async function showRelease(force) {
  const results = h("div", { id: "release-results" });
  const stamp = h("span", { class: "note" });
  const check = h("button", { type: "button", class: "btn" }, "Check again");
  check.addEventListener("click", () => checkRelease(results, stamp, check, true));
  put(view, h("div", { class: "toolbar" }, check, stamp), results);
  await checkRelease(results, stamp, check, Boolean(force));
}

// ---- work sessions ----------------------------------------------------------
// "Start in Claude": a worktree per task plus an interactive Claude session
// in a terminal window. The prompt carries only the issue ID.
async function getBoards() {
  if (!cache.boards) cache.boards = (await api("/api/work/config").catch(() => ({ boards: {} }))).boards;
  return cache.boards;
}

function toast(text, isError) {
  const el = h("div", { class: `toast${isError ? " bad" : ""}`, role: "status" }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), isError ? 9000 : 6000);
}

// A hint from the planner's stage text ("Development in progress"); the
// server re-reads the stage codes and makes the real choice (see
// work_session.choose_action), e.g. Implement becomes Resume when a worktree exists.
const ACTIONS = {
  spec: { label: "Spec", help: "Write a spec and stop for review (no code)" },
  implement: { label: "Implement", help: "Spec, check for blockers, then implement and commit locally" },
  resume: { label: "Resume", help: "Continue in the existing worktree" },
  qa: { label: "Fix QA", help: "Fix testing/QA feedback on the task branch" },
  blocked: { label: "Blocked", help: "Explain the blocker and draft a question (read only)" },
};
const STAGE_ORDER = [["rsd", "spec"], ["estimate", "spec"], ["development", "implement"], ["testing", "qa"], ["qa", "qa"], ["live", null], ["going live", null]];

function actionFor(stageText) {
  const m = /^(.+?)\s+(pending|not started|in progress|blocked|done|completed|skipped)$/i.exec((stageText || "").trim());
  if (!m) return "implement";
  if (m[2].toLowerCase() === "blocked") return "blocked";
  const stage = STAGE_ORDER.find(([name]) => name === m[1].toLowerCase());
  return stage ? stage[1] : "implement";
}

async function startClaude(issue, code, button) {
  if (button) button.disabled = true;
  try {
    const r = await api("/api/work/start", {
      method: "POST",
      headers: { "X-Timeline-Desk": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ issue: String(issue), code: String(code) }),
    });
    const where = r.branch ? `${r.created ? "new worktree" : "existing worktree"} · branch ${r.branch}` : "main checkout, read only";
    toast(`Claude opened for #${issue} (${r.label}) in a terminal · ${where}`);
  } catch (error) {
    toast(`Couldn't start #${issue}: ${error.message}`, true);
  } finally {
    if (button) button.disabled = false;
  }
}

// `stageText` picks the label; null hides the button (QA passed or live).
function startButton(issue, code, boards, compact, stageText, forced) {
  if (!code || !boards[String(code)]) return null;
  const action = forced || actionFor(stageText);
  if (!action) return null;
  const { label, help } = ACTIONS[action];
  const button = h("button", {
    type: "button",
    class: `${compact ? "start" : "btn"} act-${action}`,
    title: `${help} · ${boards[String(code)]}`,
    "aria-label": `${label} #${issue} in Claude`,
  }, compact ? `${action === "blocked" ? "⏸" : "▶"} ${label}` : `${label} in Claude`);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    startClaude(issue, code, button);
  });
  return button;
}

function sizeText(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function removeWorktree(item, withBranch, button) {
  const what = withBranch ? `the worktree and branch ${item.branch}` : "the worktree (the branch stays)";
  if (!window.confirm(`Remove ${what} for #${item.issue_id || item.branch}?`)) return;
  button.disabled = true;
  try {
    const r = await api("/api/work/remove", {
      method: "POST",
      headers: { "X-Timeline-Desk": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ path: item.path, delete_branch: withBranch }),
    });
    toast(r.branch_note || `Removed ${item.branch}${r.branch_deleted ? " and its branch" : ""}.`, Boolean(r.branch_note));
  } catch (error) {
    toast(error.message, true);
  }
  showWork();
}

async function showWork() {
  loading("Loading task worktrees…");
  const [{ worktrees }, boards] = await Promise.all([api("/api/work/worktrees"), getBoards()]);
  if (!Object.keys(boards).length) {
    put(view, h("p", { class: "note" }, "No repos set up. Copy timeline-desk.example.json to timeline-desk.json and add your board → repo paths."));
    return;
  }
  const total = worktrees.reduce((sum, w) => sum + w.size, 0);
  const rows = worktrees.map((w) => {
    const facts = [];
    if (!w.exists) facts.push("folder missing");
    if (w.dirty) facts.push(`${w.dirty} uncommitted`);
    if (w.unpushed) facts.push(`${w.unpushed} commit${w.unpushed === 1 ? "" : "s"} only here`);
    if (w.merged) facts.push(`no new commits vs base`);
    if (!facts.length) facts.push("clean");
    const remove = h("button", { type: "button", class: "btn ghost small" }, "Remove");
    remove.addEventListener("click", () => removeWorktree(w, false, remove));
    const both = h("button", { type: "button", class: "btn ghost small" }, "Remove + branch");
    both.addEventListener("click", () => removeWorktree(w, true, both));
    if (w.dirty) { remove.disabled = true; both.disabled = true; remove.title = both.title = "Commit or discard the changes first"; }
    return h("tr", {},
      h("td", {}, w.issue_id ? h("a", { href: `#/task/${w.issue_id}`, class: "issue" }, `#${w.issue_id}`) : "—"),
      h("td", {}, h("code", {}, w.branch || "(detached)"), h("div", { class: "note" }, w.repo)),
      h("td", {}, sizeText(w.size)),
      h("td", { class: w.dirty || w.unpushed ? "warn-text" : "" }, facts.join(" · ")),
      h("td", { class: "actions" },
        w.issue_id && w.exists ? startButton(w.issue_id, w.code, boards, true, null, "resume") : null, remove, both));
  });
  put(view,
    h("p", { class: "summary" }, h("strong", {}, String(worktrees.length)), ` task worktree${worktrees.length === 1 ? "" : "s"} · ${sizeText(total)}`),
    worktrees.length
      ? h("table", { class: "work" },
        h("thead", {}, h("tr", {}, ["Task", "Branch", "Size", "State", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, rows))
      : h("p", { class: "note" }, "No task worktrees. Use ▶ Claude on a board card to start one."),
    h("p", { class: "note" }, "Remove never forces: git keeps a worktree with uncommitted changes and a branch with commits that aren't merged anywhere."));
}

// ---- task -----------------------------------------------------------------
async function showTask(issue) {
  const input = h("input", { type: "text", id: "task-id", value: issue || "", "aria-label": "Issue ID or task URL", placeholder: "Issue ID or task URL", size: "34" });
  const open = () => {
    const id = parseIds(input.value)[0] || input.value.trim();
    if (id) location.hash = `#/task/${id}`;
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  const toolbar = h("div", { class: "toolbar" }, input, h("button", { type: "button", class: "btn", onclick: open }, "Open task"));
  if (!issue) {
    put(view, toolbar, h("p", { class: "note" }, "Open a task from the board, or enter its issue ID."));
    input.focus();
    return;
  }
  put(view, toolbar, h("p", { class: "note" }, `Loading #${issue}…`));
  let task;
  try {
    task = await api(`/api/task/${encodeURIComponent(issue)}`);
  } catch (error) {
    put(view, toolbar, h("p", { class: "error", role: "alert" }, error.message));
    return;
  }
  const status = (await loadStatuses([task.issue_id]).catch(() => [null]))[0];
  await getPlanner().catch(() => null); // for the Timeline link of planner tasks
  const planned = cache.planner && Object.values(cache.planner.periods).flatMap((p) => p.tasks)
    .find((t) => String(t.issue_number) === String(task.issue_id));
  const link = planned && planned.url;
  const head = h("section", { class: "task-head" },
    h("span", { class: "issue" }, `#${task.issue_id}`),
    h("h2", {}, task.title || "(no title)"),
    h("div", { class: "facts" },
      status && !status.error ? h("span", {}, status.stage_status) : null,
      task.creator ? h("span", {}, `Created by ${task.creator}`) : null,
      task.created_date ? h("span", {}, niceDate(task.created_date, false)) : null,
      task.tags.length ? h("span", {}, `Tags: ${task.tags.join(", ")}`) : null,
      link ? h("a", { href: link, target: "_blank", rel: "noopener noreferrer" }, "Open in Timeline ↗") : null),
    planned ? startButton(task.issue_id, planned.code, await getBoards(), false, (status && !status.error ? status.stage_status : planned.stage_status)) : null,
    railKey(),
    rail(status && !status.error ? status : null));
  const description = plainText(task.description);
  const comments = task.comments.map((c) => h("li", {},
    h("div", { class: "who" }, c.author,
      c.author && c.author === task.creator ? h("span", { class: "creator" }, "task creator") : null,
      h("small", {}, c.created_at)),
    plainText(c.description) ? richText(c.description) : null));
  put(view, 
    toolbar, head,
    h("h3", { class: "task-section" }, "Description"),
    description ? richText(task.description) : h("p", { class: "note" }, "No description."),
    h("h3", { class: "task-section" }, `Conversation (${task.comments.length})`),
    comments.length ? h("ol", { class: "comments" }, comments) : h("p", { class: "note" }, "No comments yet."));
}

// ---- routing --------------------------------------------------------------
async function route(force) {
  const [, name = "board", arg] = (location.hash || "#/board").split("/");
  for (const tab of document.querySelectorAll(".tabs a")) {
    if (tab.dataset.view === name) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  try {
    if (name === "changes") await showChanges();
    else if (name === "release") await showRelease(force);
    else if (name === "work") await showWork();
    else if (name === "task") await showTask(arg ? decodeURIComponent(arg) : "");
    else await showBoard(force);
  } catch (error) {
    showError(error);
  }
}

document.getElementById("refresh").addEventListener("click", async () => {
  cache.statuses.clear();
  cache.planner = null;
  await route(true);
  getPlanner().catch(() => {});
});

window.addEventListener("hashchange", () => route(false));
route(false);
if (!location.hash.startsWith("#/board") && location.hash) getPlanner().catch(() => {});
