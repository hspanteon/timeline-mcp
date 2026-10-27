// Timeline desk. All Timeline text is inserted with textContent, never as HTML.
"use strict";

const STAGES = ["RSD", "Estimate", "Development", "Testing", "QA", "Live"];
const STAGE_SHORT = ["RSD", "Est", "Dev", "Test", "QA", "Live"];

const view = document.getElementById("view");
const meta = document.getElementById("meta");
const cache = { planner: null, statuses: new Map(), boards: null, projects: null, projectTasks: new Map() };

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

// Only Timeline's own attachments are previewed, through the local proxy.
function attachmentSrc(href) {
  const m = href.match(/^https:\/\/timeline\.panteon\.no\/storage\/attachments\/([\w-]+\.(?:jpe?g|png|gif|webp))$/i);
  return m ? `/api/attachment/${m[1]}` : null;
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
      const preview = m[2] !== undefined && href && attachmentSrc(href);
      if (preview) {
        out.push(h("a", { class: "preview", href, target: "_blank", rel: "noopener noreferrer", title: "Open full size" },
          h("img", { src: preview, alt: m[1] || "image", loading: "lazy" })));
        continue;
      }
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

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function tableBlock(header, separator, rows) {
  const align = tableCells(separator).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : null));
  const cell = (tag, text, i) => h(tag, align[i] ? { style: `text-align: ${align[i]}` } : {}, inline(text));
  return h("div", { class: "md-table" }, h("table", {},
    h("thead", {}, h("tr", {}, tableCells(header).map((c, i) => cell("th", c, i)))),
    h("tbody", {}, rows.map((r) => h("tr", {}, tableCells(r).map((c, i) => cell("td", c, i)))))));
}

function richText(source) {
  const lines = plainText(source).split("\n");
  const root = h("div", { class: "body rich" });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    const item = line.match(/^\s*([-*]|\d+[.)])\s+(.*)$/);
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) code.push(lines[i]);
      root.append(h("pre", { class: "md-code" }, code.join("\n")));
    } else if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("|") && TABLE_SEPARATOR.test(lines[i + 1])) {
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim()) rows.push(lines[j++]);
      root.append(tableBlock(line, lines[i + 1], rows));
      i = j - 1;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) root.append(h("hr", {}));
    else if (/^\s*>/.test(line)) {
      const quote = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ""));
      i--;
      root.append(h("blockquote", {}, quote.map((q) => h("div", {}, q ? inline(q) : " "))));
    } else if (heading) root.append(h("strong", { class: `md-h md-h${heading[1].length}` }, inline(heading[2])));
    else if (item) root.append(h("div", { class: "md-li" }, `${/\d/.test(item[1]) ? item[1] : "•"} `, inline(item[2])));
    else root.append(h("div", {}, line ? inline(line) : " "));
  }
  return root;
}

// Avatar: initials, with the profile photo (via the local proxy) over them once it loads.
function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function avatar(name, photo, title) {
  const el = h("span", { class: "avatar", "aria-hidden": title ? null : "true", title }, initials(name));
  if (photo) {
    const img = h("img", { src: `/api/photo/${encodeURIComponent(photo)}`, alt: "", loading: "lazy" });
    img.addEventListener("load", () => el.classList.add("has-photo"));
    img.addEventListener("error", () => img.remove());
    el.append(img);
  }
  return el;
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
  const card = h("a", { class: "card", href: `#/task/${task.issue_number}` },
    h("div", { class: "head" },
      h("span", { class: "issue" }, `#${task.issue_number}`),
      flagBadge(task.deadline_flag),
      task.support ? h("span", { class: "badge support" }, "support") : null),
    h("p", { class: "title" }, task.title),
    rail(cache.statuses.get(String(task.issue_number))),
    h("div", { class: "foot" },
      h("span", { class: "stage" }, task.stage_status || "No stage"),
      h("span", {}, task.deadline ? niceDate(task.deadline) : "No deadline")));
  return start ? h("div", { class: "card-wrap" }, card, start) : card;
}

async function showPlanner(force) {
  loading("Loading your planner…");
  const [p, boards] = await Promise.all([getPlanner(force), getBoards()]);
  // Stages aren't in the planner response: fetch them first so each card is drawn once, final.
  const ids = Object.values(p.periods).flatMap((period) => period.tasks.map((t) => t.issue_number));
  await loadStatuses(ids).catch(() => null); // on failure the rails stay dashed
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
}

// ---- changes --------------------------------------------------------------
const PERIOD_LABEL = { now: "Now", next: "Next", commingup: "Coming up" };
const periodLabel = (p) => PERIOD_LABEL[p] || p || "—";

// What happened, in the order people care about. Colour is kept for deadlines only.
const CHANGE_KINDS = [
  { key: "added", label: "New", short: "New", icon: "+" },
  { key: "removed", label: "Left the planner", short: "Left", icon: "−" },
  { key: "moved", label: "Moved", short: "Moved", icon: "⇄" },
  { key: "changed", label: "Changed", short: "Changed", icon: "✎" },
];

const chip = (text, tone, title) => h("span", { class: `chip ${tone || ""}`, title: title || null }, text);

// "in 2 days", "tomorrow", "3 days overdue": how far the deadline is from today.
function countdown(deadline) {
  const days = Math.round((new Date(`${deadline}T00:00:00`) - new Date(new Date().toDateString())) / 86400000);
  if (Number.isNaN(days)) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

function deadlineChip(task) {
  if (!task.deadline) return chip("No deadline", "muted");
  const flag = task.deadline_flag;
  return chip(`${niceDate(task.deadline)} · ${countdown(task.deadline)}`,
    flag === "overdue" ? "overdue" : flag ? "soon" : "");
}

function spanText(from, to) {
  const minutes = Math.round((new Date(to) - new Date(from)) / 60000);
  if (Number.isNaN(minutes) || minutes < 0) return "";
  if (minutes < 60) return "under an hour";
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`;
  const days = Math.round(minutes / 1440);
  return `${days} day${days === 1 ? "" : "s"}`;
}

const RELEASE_LABEL = { "before qa": "Before QA", "in qa": "In QA", "qa blocked": "QA blocked", "qa approved": "QA approved", live: "Live" };

// One "before → after" line; the old value is struck through, the new one bold.
function deltaLine(name, before, after) {
  return h("div", { class: "delta" },
    h("span", { class: "field" }, name),
    h("span", { class: "was" }, before || "—"),
    h("span", { class: "arrow" }, "→"),
    h("span", { class: "now" }, after || "—"));
}

function fieldChange([name, before, after]) {
  const show = (v) => (name === "deadline" && v ? niceDate(v) : v);
  return deltaLine(name, show(before), show(after));
}

let changeBoards = {};

function changeItem(task, kind, at) {
  let facts;
  if (kind.key === "removed") {
    facts = [h("span", { class: "note" }, `was in ${periodLabel(task.period)} · ${task.stage_status || "no stage"}`)];
  } else {
    facts = [
      chip(`${periodLabel(task.period)} · #${task.position}`, "", "Priority position in this period"),
      chip(task.stage_status || "No stage"),
      deadlineChip(task),
      task.release_state ? chip(RELEASE_LABEL[task.release_state] || task.release_state) : null,
      task.support ? chip("Support") : null,
      task.code ? chip(changeBoards[String(task.code)] || `Board ${task.code}`, "muted") : null,
    ];
  }
  // Under an hour says nothing useful, so the note starts at an hour.
  const onPlanner = task.on_planner_since ? spanText(task.on_planner_since, at) : "";
  if (onPlanner && onPlanner !== "under an hour") {
    facts.push(h("span", { class: "note" },
      `on your planner for ${task.since_tracking_start ? "at least " : ""}${onPlanner}`));
  }
  const details = kind.key === "changed" ? task.changes.map(fieldChange)
    : kind.key === "moved" ? [deltaLine("period", periodLabel(task.from), periodLabel(task.to))] : [];
  return h("li", { class: "item" },
    h("div", { class: "item-head" },
      h("span", { class: "kind" }, h("b", { "aria-hidden": "true" }, kind.icon), kind.short),
      h("a", { href: `#/task/${task.issue_number}` }, h("span", { class: "issue" }, `#${task.issue_number}`)),
      h("span", { class: "item-title" }, task.title || ""),
      task.url ? h("a", { class: "ext", href: task.url, target: "_blank", rel: "noopener noreferrer", title: "Open in Timeline" }, "↗") : null),
    details.length ? h("div", { class: "deltas" }, details) : null,
    task.stages && kind.key !== "removed" ? h("div", { class: "stages" }, rail({ stages: task.stages }), railKey()) : null,
    h("div", { class: "facts" }, facts));
}

function ago(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}


function dayNote(date) {
  const day = (d) => new Date(d).toDateString();
  if (day(`${date}T12:00:00`) === day(Date.now())) return "Today";
  if (day(`${date}T12:00:00`) === day(Date.now() - 86400000)) return "Yesterday";
  return "";
}

// Remembered per browser, so entries found since your last visit stand out.
// Read once per page load: a background refresh must not mark them seen.
let changesSeenAt = "";
try { changesSeenAt = localStorage.getItem("changesSeenAt") || ""; } catch { /* storage blocked */ }
let changesFilter = "all";

function niceTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

const CHANGES_REFRESH_MS = 60 * 1000;
let changesTimer = null;

const recordSnapshot = () => api("/api/snapshot", { method: "POST", headers: { "X-Timeline-Desk": "1" } });

// `check` fetches the planner from Timeline first, so a task added a minute
// ago shows up; otherwise this only reads what the background check stored.
async function showChanges(quiet = false, check = false) {
  clearTimeout(changesTimer);
  if (!quiet) loading(check ? "Checking the planner…" : "Loading planner history…");
  let checkError = "";
  if (check) {
    try { await recordSnapshot(); } catch (error) { checkError = error.message; }
  }
  const [history, boards] = await Promise.all([api("/api/changes"), getBoards()]);
  changeBoards = boards || {};
  const status = h("span", { class: "note", id: "snapshot-status" },
    checkError || (history.last_checked ? `Last checked ${niceTime(history.last_checked)} (${ago(history.last_checked)})` : ""));

  // Totals for the last 24 hours double as filters.
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const recent = history.changes.filter((e) => new Date(e.taken_at).getTime() >= dayAgo);
  const total = (list, key) => list.reduce((n, e) => n + e.diff[key].length, 0);
  const filters = h("div", { class: "filters", role: "group", "aria-label": "Filter changes" },
    h("button", { type: "button", class: "filter", "aria-pressed": String(changesFilter === "all"),
      onclick: () => { changesFilter = "all"; showChanges(true); } }, "All"),
    CHANGE_KINDS.map((k) => h("button", { type: "button", class: `filter ${k.key}`,
      "aria-pressed": String(changesFilter === k.key),
      title: "Last 24 hours",
      onclick: () => { changesFilter = changesFilter === k.key ? "all" : k.key; showChanges(true); } },
      h("b", { "aria-hidden": "true" }, k.icon), `${k.label} `, h("span", { class: "count" }, total(recent, k.key)))));

  const unseen = (e) => changesSeenAt && e.taken_at > changesSeenAt;
  // One section per day (the main level); inside it, one row per detection time.
  const days = new Map();
  for (const entry of history.changes) {
    const items = CHANGE_KINDS
      .filter((k) => changesFilter === "all" || changesFilter === k.key)
      .flatMap((k) => entry.diff[k.key].map((t) => ({ task: t, kind: k })));
    if (!items.length) continue;
    const date = entry.taken_at.slice(0, 10);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push({ entry, items });
  }
  // One continuous rail: a big marker per day, a dot per detection time.
  const rail = (kind) => h("div", { class: "rail-col", "aria-hidden": "true" }, h("i", { class: `dot ${kind}` }));
  const rows = [];
  for (const [date, slots] of days) {
    const count = slots.reduce((n, r) => n + r.items.length, 0);
    rows.push(h("div", { class: "row day-row" },
      h("div", { class: "when" }),
      rail("day"),
      h("h2", {}, niceDate(date), dayNote(date) ? h("span", { class: "today" }, dayNote(date)) : null,
        h("small", {}, `${count} change${count === 1 ? "" : "s"}`))));
    for (const { entry, items } of slots) {
      rows.push(h("div", { class: "row slot" },
        h("div", { class: "when" },
          h("span", { class: "clock" }, clock(entry.taken_at)),
          h("span", { class: "ago" }, ago(entry.taken_at))),
        rail(unseen(entry) ? "unseen" : "time"),
        h("ul", { class: "change" }, items.map(({ task, kind }) => changeItem(task, kind, entry.taken_at)))));
    }
  }
  const entries = rows.length ? h("div", { class: "timeline" }, rows) : null;

  let intro;
  if (!history.tracking_since) intro = "No snapshots yet. Press Refresh to start tracking.";
  else if (!history.changes.length) intro = `Tracking since ${niceTime(history.tracking_since)}. Nothing has changed yet; the planner is checked every few minutes.`;
  else if (!entries) intro = "No changes of this kind. Pick another filter.";
  put(view,
    h("div", { class: "toolbar" }, status),
    history.changes.length ? filters : null,
    intro ? h("p", { class: "note" }, intro) : null,
    entries);
  if (history.changes.length) {
    try { localStorage.setItem("changesSeenAt", history.changes[0].taken_at); } catch { /* storage blocked */ }
  }
  // The dashboard checks the planner in the background; pick up what it found.
  changesTimer = setTimeout(() => {
    if (location.hash === "#/changes") showChanges(true).catch(() => {});
  }, CHANGES_REFRESH_MS);
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

// ---- my tasks (project list) ----------------------------------------------
const listState = { project: null, tab: null, q: "", tag: "", stage: "", overdue: false, closed: new Set() };
let listToken = 0;
const TAG_COLOR = /^#[0-9a-f]{3,8}$/i;

async function getProjects() {
  if (!cache.projects) cache.projects = (await api("/api/work/config").catch(() => ({ projects: [] }))).projects || [];
  return cache.projects;
}

async function getProjectTasks(project, tab, refresh) {
  const key = `${project.id}|${tab || ""}`;
  if (refresh || !cache.projectTasks.has(key)) {
    cache.projectTasks.set(key, await api(`/api/project/${project.id}/tasks${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`));
  }
  return cache.projectTasks.get(key);
}

function tagChip(tag) {
  const style = TAG_COLOR.test(tag.color || "") ? `--tag: ${tag.color}` : null;
  return h("span", { class: "tag", style }, tag.name);
}

function hoursText(t) {
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const spent = Number(t.hours_spent) || 0;
  const estimate = parseFloat(String(t.hours_estimated ?? "").replace(",", "."));
  if (!spent && !(estimate > 0)) return "–";
  return estimate > 0 ? `${fmt(spent)} / ${fmt(estimate)}h` : `${fmt(spent)}h`;
}

function taskRow(t, boards) {
  return h("a", { class: "trow", href: `#/task/${t.issue_number}` },
    h("span", { class: "issue" }, `#${t.issue_number}`),
    h("div", { class: "ttitle" },
      h("span", { class: "tname" }, t.title),
      t.tags.length ? h("span", { class: "tags" }, t.tags.map(tagChip)) : null),
    rail(t),
    h("span", { class: "stage" }, t.stage_status || "–"),
    h("span", { class: "tdue" }, t.deadline ? niceDate(t.deadline, false) : "–", flagBadge(t.deadline_flag)),
    h("span", { class: "thours" }, hoursText(t)),
    h("span", { class: "people" }, t.subscribers.map((p) => avatar(p.name, p.photo, p.name))),
    h("span", { class: "tact" }, startButton(t.issue_number, t.code, boards, true, t.stage_status)));
}

async function showTaskList(toolbar, refresh) {
  const projects = await getProjects();
  if (!projects.length) {
    put(view, toolbar, h("p", { class: "note" }, 'No project set up. Add an "id" (the API project id) to a repo in timeline-desk.json.'));
    return;
  }
  const project = projects.find((p) => p.id === listState.project) || projects[0];
  listState.project = project.id;
  const boards = await getBoards();
  const body = h("div", { class: "mytasks" });
  put(view, toolbar, body);
  const token = ++listToken;

  const draw = (data) => {
    const all = data.groups.flatMap((g) => g.tasks);
    const tagNames = [...new Set(all.flatMap((t) => t.tags.map((x) => x.name)))].sort();
    const stageNames = [...new Set(all.map((t) => t.stage_status).filter(Boolean))].sort();
    if (listState.tag && !tagNames.includes(listState.tag)) listState.tag = "";
    if (listState.stage && !stageNames.includes(listState.stage)) listState.stage = "";

    const select = (label, options, key) => {
      const el = h("select", { "aria-label": label }, h("option", { value: "" }, label), options.map((o) => h("option", { value: o }, o)));
      el.value = listState[key];
      el.addEventListener("change", () => { listState[key] = el.value; renderList(); });
      return el;
    };
    const search = h("input", { type: "text", placeholder: "Filter tasks…", "aria-label": "Filter tasks", value: listState.q, size: "22" });
    search.addEventListener("input", () => { listState.q = search.value; renderList(); });
    const overdue = h("input", { type: "checkbox" });
    overdue.checked = listState.overdue;
    overdue.addEventListener("change", () => { listState.overdue = overdue.checked; renderList(); });
    const projectPicker = projects.length > 1
      ? h("select", { "aria-label": "Project", onchange: (e) => { listState.project = Number(e.target.value); listState.tab = null; showTaskList(toolbar); } },
        projects.map((p) => h("option", { value: p.id, selected: p.id === project.id }, p.name)))
      : null;
    const summary = h("span", { class: "note" });
    const listEl = h("div", { class: "tlist" });

    const renderList = () => {
      const q = listState.q.trim().toLowerCase();
      const keep = (t) => (!q || `#${t.issue_number} ${t.title} ${t.tags.map((x) => x.name).join(" ")}`.toLowerCase().includes(q))
        && (!listState.tag || t.tags.some((x) => x.name === listState.tag))
        && (!listState.stage || t.stage_status === listState.stage)
        && (!listState.overdue || t.deadline_flag === "overdue");
      const groups = data.groups.map((g) => ({ name: g.name, tasks: g.tasks.filter(keep) })).filter((g) => g.tasks.length);
      const shown = groups.reduce((n, g) => n + g.tasks.length, 0);
      const late = all.filter((t) => t.deadline_flag === "overdue").length;
      summary.textContent = `${shown} of ${all.length} task${all.length === 1 ? "" : "s"}${late ? ` · ${late} overdue` : ""}`;
      put(listEl,
        shown ? h("div", { class: "trow thead", "aria-hidden": "true" },
          h("span"), h("span", {}, "Task"), railKey(), h("span", {}, "Stage"), h("span", {}, "Due"), h("span", {}, "Hours"), h("span", {}, "People"), h("span")) : null,
        groups.map((g) => {
          const id = `${data.tab}|${g.name}`;
          const details = h("details", { class: "tgroup", open: !listState.closed.has(id) },
            h("summary", {}, h("span", { class: "gname" }, g.name), h("span", { class: "count" }, g.tasks.length)),
            g.tasks.map((t) => taskRow(t, boards)));
          details.addEventListener("toggle", () => {
            if (details.open) listState.closed.delete(id); else listState.closed.add(id);
          });
          return details;
        }),
        shown ? null : h("p", { class: "note" }, "No tasks match."));
    };

    put(body,
      h("div", { class: "list-head" }, h("h2", {}, "My tasks"), projectPicker, summary),
      h("nav", { class: "subtabs", "aria-label": "Task tabs" }, data.tabs.map((t) => h("button", {
        type: "button", class: "subtab", "aria-current": t.name === data.tab ? "page" : null, onclick: () => load(t.name),
      }, t.name, h("span", { class: "count" }, t.count)))),
      h("div", { class: "filters" }, search, select("All tags", tagNames, "tag"), select("All stages", stageNames, "stage"),
        h("label", { class: "check" }, overdue, " Overdue only")),
      listEl);
    renderList();
  };

  const load = async (tab, force) => {
    put(body, h("p", { class: "note" }, "Loading your tasks…"));
    let data;
    try {
      data = await getProjectTasks(project, tab, force);
    } catch (error) {
      if (token === listToken) put(body, h("p", { class: "error", role: "alert" }, error.message));
      return;
    }
    if (token !== listToken) return;
    listState.tab = data.tab;
    draw(data);
  };
  await load(listState.tab, refresh);
}

// ---- task -----------------------------------------------------------------
async function showTask(issue, force) {
  const input = h("input", { type: "text", id: "task-id", value: issue || "", "aria-label": "Issue ID or task URL", placeholder: "Issue ID or task URL", size: "34" });
  const open = () => {
    const id = parseIds(input.value)[0] || input.value.trim();
    if (id) location.hash = `#/task/${id}`;
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  const toolbar = h("div", { class: "toolbar" }, input, h("button", { type: "button", class: "btn", onclick: open }, "Open task"),
    issue ? h("a", { href: "#/task", class: "back" }, "← My tasks") : null);
  if (!issue) {
    await showTaskList(toolbar, force);
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
  const copyIcon = () => new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    "image/svg+xml").documentElement;
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); toast("Copied to clipboard."); }
    catch { toast("Couldn't copy — clipboard not available.", true); }
  };
  const photos = new Map(task.comments.filter((c) => c.photo).map((c) => [c.author, c.photo]));
  const post = (author, date, content, label, text, photo) => h("li", { class: "post" },
    avatar(author, photo),
    h("div", { class: "post-card" },
      h("div", { class: "post-head" },
        h("strong", {}, author || "Unknown"),
        h("button", { type: "button", class: "icon-btn", title: "Copy text", "aria-label": "Copy text", onclick: () => copyText(text || "") }, copyIcon()),
        label ? h("span", { class: "creator" }, label) : null,
        h("small", {}, date || "")),
      content));
  const comments = task.comments.map((c) => post(c.author, c.created_at,
    plainText(c.description) ? richText(c.description) : h("p", { class: "note" }, "(no text)"),
    c.author && c.author === task.creator ? "task creator" : null, plainText(c.description), c.photo));
  put(view,
    toolbar, head,
    h("h3", { class: "task-section" }, "Description"),
    h("ol", { class: "comments" }, post(task.creator, task.created_date ? niceDate(task.created_date, false) : "",
      description ? richText(task.description) : h("p", { class: "note" }, "No description."), "task creator", description, photos.get(task.creator))),
    h("h3", { class: "task-section" }, `Conversation (${task.comments.length})`),
    comments.length ? h("ol", { class: "comments" }, comments) : h("p", { class: "note" }, "No comments yet."));
}

// ---- routing --------------------------------------------------------------
async function route(force) {
  const [, rawName = "planner", arg] = (location.hash || "#/planner").split("/");
  const name = rawName === "board" ? "planner" : rawName; // old #/board links keep working
  for (const tab of document.querySelectorAll(".tabs a")) {
    if (tab.dataset.view === name) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  try {
    if (name === "changes") await showChanges(false, force);
    else if (name === "release") await showRelease(force);
    else if (name === "work") await showWork();
    else if (name === "task") await showTask(arg ? decodeURIComponent(arg) : "", force);
    else await showPlanner(force);
  } catch (error) {
    showError(error);
  }
}

document.getElementById("refresh").addEventListener("click", async () => {
  cache.statuses.clear();
  cache.planner = null;
  cache.projectTasks.clear();
  await route(true);
  getPlanner().catch(() => {});
});

window.addEventListener("hashchange", () => route(false));
route(false);
if (!/^#\/(planner|board)/.test(location.hash) && location.hash) getPlanner().catch(() => {});
