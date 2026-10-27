// Timeline desk. All Timeline text is inserted with textContent, never as HTML.
"use strict";

const STAGES = ["RSD", "Estimate", "Development", "Testing", "QA", "Live"];
const STAGE_SHORT = ["RSD", "Est", "Dev", "Test", "QA", "Live"];

const view = document.getElementById("view");
const meta = document.getElementById("meta");
const cache = { watched: new Set(), planner: null, statuses: new Map(), boards: null, projects: null, projectTasks: new Map(), workflows: null };

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
  return markdown(plainText(source));
}

// The same subset for text that is already plain (task docs, Claude's replies).
function markdown(text) {
  const lines = String(text || "").split("\n");
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
  if (!cache.planner || force) cache.planner = await api(force ? "/api/planner?refresh=1" : "/api/planner");
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
  const start = workflowLink(task.issue_number, task.code, boards);
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
  const [p, boards] = await Promise.all([getPlanner(force), getBoards(), getWorkflows(force)]);
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
  { key: "added", label: "New", short: "New", icon: "M12 5v14M5 12h14" },
  { key: "removed", label: "Left the planner", short: "Left", icon: "M5 12h14" },
  { key: "moved", label: "Moved", short: "Moved", icon: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" },
  { key: "changed", label: "Changed", short: "Changed", icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" },
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

// One "field: before → after" row, as pills (same look as the Timeline tab).
function pairRow(name, before, after) {
  return h("div", { class: "tl-change" },
    h("span", { class: "tl-field" }, name),
    h("span", { class: "tl-pill was" }, before || "—"),
    h("span", { class: "tl-arrow", "aria-hidden": "true" }, "→"),
    h("span", { class: "tl-pill now" }, after || "—"));
}

let changeBoards = {};

// `first` puts the detection time in the left column; later cards of the same
// check leave it out. `fresh` marks entries found since the last visit.
function changeCard(task, kind, at, first, fresh) {
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
  const show = (name, v) => (name === "deadline" && v ? niceDate(v) : v);
  const rows = kind.key === "changed" ? task.changes.map(([name, before, after]) => pairRow(name, show(name, before), show(name, after)))
    : kind.key === "moved" ? [pairRow("period", periodLabel(task.from), periodLabel(task.to))] : [];
  return h("li", { class: `tl-event ${kind.key}${fresh ? " fresh" : ""}`, style: taskStyle(task.issue_number) },
    first ? h("time", { class: "tl-when", datetime: at, title: niceTime(at) }, h("b", {}, clock(at)), h("small", {}, ago(at))) : null,
    h("span", { class: "tl-node", "aria-hidden": "true" }, svgIcon(kind.icon, 15)),
    h("article", { class: "tl-card" },
      h("header", {},
        h("span", { class: `tl-kindtag ${kind.key}` }, kind.short),
        h("a", { class: "tl-task", href: `#/task/${task.issue_number}`, style: taskStyle(task.issue_number), title: task.title || "" },
          h("b", {}, `#${task.issue_number}`), task.title ? h("span", {}, task.title) : null),
        task.url ? h("a", { class: "ext", href: task.url, target: "_blank", rel: "noopener noreferrer", title: "Open in Timeline" }, "↗") : null,
        fresh ? h("span", { class: "tl-new" }, "since your last visit") : null),
      rows.length ? h("div", { class: "tl-rows" }, rows) : null,
      task.stages && kind.key !== "removed" ? h("div", { class: "stages" }, rail({ stages: task.stages }), railKey()) : null,
      h("div", { class: "facts" }, facts)));
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

  // Totals for the last 24 hours double as the counts on the filters.
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const recent = history.changes.filter((e) => new Date(e.taken_at).getTime() >= dayAgo);
  const total = (list, key) => list.reduce((n, e) => n + e.diff[key].length, 0);
  const recentTotal = CHANGE_KINDS.reduce((n, k) => n + total(recent, k.key), 0);

  const tile = (value, label, sub) => h("div", { class: "tl-tile" }, h("b", {}, value), h("span", {}, label), sub ? h("small", {}, sub) : null);
  const summary = h("section", { class: "tl-summary", "aria-label": "Summary" },
    tile(recentTotal, "changes in 24 h"),
    tile(history.tracking_since ? niceDate(history.tracking_since.slice(0, 10)) : "—", "tracking since",
      history.tracking_since ? clock(history.tracking_since) : "press Refresh"),
    tile(history.last_checked ? clock(history.last_checked) : "—", "last checked", history.last_checked ? ago(history.last_checked) : ""),
    checkError ? h("div", { class: "tl-tile bad" }, h("b", {}, "!"), h("span", {}, checkError)) : null);

  const pick = (key) => { changesFilter = key; showChanges(true); };
  const filters = h("div", { class: "tl-kinds", role: "group", "aria-label": "Filter changes" },
    h("button", { type: "button", class: "tl-kind", "aria-pressed": String(changesFilter === "all"), onclick: () => pick("all") }, "All"),
    CHANGE_KINDS.map((k) => h("button", { type: "button", class: `tl-kind ${k.key}`, "aria-pressed": String(changesFilter === k.key),
      title: "Counts are for the last 24 hours", onclick: () => pick(changesFilter === k.key ? "all" : k.key) },
      svgIcon(k.icon, 14), k.label, h("span", { class: "tl-n" }, total(recent, k.key)))));

  const unseen = (e) => Boolean(changesSeenAt) && e.taken_at > changesSeenAt;
  // One section per day; inside it, one card per task, the time on the first card of each check.
  const feed = h("ol", { class: "tl-feed" });
  let day = null, any = false;
  for (const entry of history.changes) {
    const items = CHANGE_KINDS
      .filter((k) => changesFilter === "all" || changesFilter === k.key)
      .flatMap((k) => entry.diff[k.key].map((t) => ({ task: t, kind: k })));
    if (!items.length) continue;
    any = true;
    const date = entry.taken_at.slice(0, 10);
    if (date !== day) {
      day = date;
      const count = history.changes.filter((e) => e.taken_at.startsWith(date))
        .reduce((n, e) => n + CHANGE_KINDS.filter((k) => changesFilter === "all" || changesFilter === k.key)
          .reduce((m, k) => m + e.diff[k.key].length, 0), 0);
      feed.append(h("li", { class: "tl-day" }, h("h2", {}, niceDate(date), dayNote(date) ? h("em", {}, dayNote(date)) : null),
        h("span", { class: "tl-count" }, `${count} change${count === 1 ? "" : "s"}`)));
    }
    items.forEach(({ task, kind }, i) => feed.append(changeCard(task, kind, entry.taken_at, i === 0, unseen(entry))));
  }

  let intro = null;
  if (!history.tracking_since) intro = "No snapshots yet. Press Refresh to start tracking.";
  else if (!history.changes.length) intro = `Tracking since ${niceTime(history.tracking_since)}. Nothing has changed yet; the planner is checked every few minutes.`;
  else if (!any) intro = "No changes of this kind. Pick another filter.";
  put(view, h("div", { class: "tl-page" }, summary,
    history.changes.length ? h("div", { class: "tl-controls" }, filters) : null,
    intro ? h("p", { class: "note" }, intro) : null,
    any ? feed : null));
  if (history.changes.length) {
    try { localStorage.setItem("changesSeenAt", history.changes[0].taken_at); } catch { /* storage blocked */ }
  }
  // The dashboard checks the planner in the background; pick up what it found.
  changesTimer = setTimeout(() => {
    if (location.hash === "#/changes") showChanges(true).catch(() => {});
  }, CHANGES_REFRESH_MS);
}

// ---- timeline (events of watched tasks) -------------------------------------
const writeHeaders = { "X-Timeline-Desk": "1" };

async function loadWatched() {
  try {
    const { watchlist } = await api("/api/watchlist");
    cache.watched = new Set(watchlist.filter((w) => w.active).map((w) => String(w.issue_number)));
  } catch { /* the button then offers Watch; the server decides */ }
}

// Watch / Unwatch toggle. Only your own open tasks can be watched (the server checks).
function watchButton(issue) {
  const id = String(issue);
  const button = h("button", { type: "button", class: "watch" });
  const draw = () => {
    const on = cache.watched.has(id);
    button.textContent = on ? "★" : "☆";
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", `${on ? "Stop watching" : "Watch"} #${id}`);
    button.title = on ? "Watching: its changes go to the Timeline. Click to stop." : "Add this task's changes to the Timeline";
  };
  draw();
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      if (cache.watched.has(id)) {
        await api(`/api/watchlist/${id}`, { method: "DELETE", headers: writeHeaders });
        cache.watched.delete(id);
      } else {
        await api("/api/watchlist", { method: "POST", headers: { ...writeHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ issue: id }) });
        cache.watched.add(id);
      }
    } catch (error) { toast(error.message, true); }
    button.disabled = false;
    draw();
  });
  return button;
}

// Event kinds: label, verb on the card, and the icon on the rail.
const EVENT_KINDS = {
  comment: { label: "Comments", verb: "commented", icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" },
  status: { label: "Status", verb: "changed the status", icon: "M5 12h14M13 6l6 6-6 6" },
  field: { label: "Fields", verb: "updated", icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" },
  commit: { label: "Commits", verb: "committed", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 12h6M15 12h6" },
};
// The last event types and task chosen on the Timeline page survive a reload (per browser).
const FILTERS_KEY = "timeline-desk.timeline-filters";
function loadFilters() {
  const state = { issues: new Set(), kinds: new Set(["comment", "status", "field"]), q: "" };
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) || "null");
    if (saved && Array.isArray(saved.kinds)) state.kinds = new Set(saved.kinds.filter((k) => k in EVENT_KINDS));
    if (saved && Array.isArray(saved.issues)) state.issues = new Set(saved.issues.map(String));
  } catch (error) { /* storage blocked or unreadable: use the defaults */ }
  return state;
}
function saveFilters() {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ kinds: [...eventsState.kinds], issues: [...eventsState.issues] }));
  } catch (error) { /* storage blocked: the choice just won't be remembered */ }
}
const eventsState = loadFilters();
let eventsToken = 0;

function svgIcon(path, size = 16) {
  return new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`,
    "image/svg+xml").documentElement;
}

// Each task gets its own hue, so a task is recognisable at a glance down the feed.
const taskHue = (issue) => (Number(issue) * 137) % 360;
const taskStyle = (issue) => `--hue: ${taskHue(issue)}`;

function valueTone(text) {
  if (/block|fail|reject/i.test(text)) return "bad";
  if (/done|approved|live|complete|finish/i.test(text)) return "good";
  if (/progress|testing|working/i.test(text)) return "warn";
  return "";
}

function changePills(e) {
  const dated = /deadline|date/i.test(e.field_name);
  const show = (v) => (v ? (dated ? niceDate(v, false) : v) : "—");
  const status = e.kind === "status";
  return h("div", { class: "tl-change" },
    status ? null : h("span", { class: "tl-field" }, e.field_name),
    h("span", { class: `tl-pill was ${status ? valueTone(e.old_value || "") : ""}` }, show(e.old_value)),
    h("span", { class: "tl-arrow", "aria-hidden": "true" }, "→"),
    h("span", { class: `tl-pill now ${status ? valueTone(e.new_value || "") : ""}` }, show(e.new_value)));
}

function commentBody(e) {
  const text = plainText(e.body);
  if (!text) return h("p", { class: "note" }, "(no text)");
  const box = h("div", { class: "tl-bubble clamped" }, richText(e.body));
  const long = text.length > 320 || text.split("\n").length > 6;
  if (!long) box.classList.remove("clamped");
  const more = long ? h("button", { type: "button", class: "tl-more", "aria-expanded": "false",
    onclick: () => {
      const open = box.classList.toggle("clamped") === false;
      more.textContent = open ? "Show less" : "Show more";
      more.setAttribute("aria-expanded", String(open));
    } }, "Show more") : null;
  return h("div", {}, box, more);
}

function commitLine(e) {
  const sha = e.url && (e.url.match(/\/commit\/([0-9a-f]{7,40})/i) || [])[1];
  const message = plainText(e.body).replace(/^TL\s*#\d+\s*/i, "") || "Commit";
  const safe = e.url && /^https:\/\//.test(e.url);
  const code = sha ? h("code", { class: "tl-sha" }, sha.slice(0, 7)) : null;
  return h("div", { class: "tl-commit" },
    safe && code ? h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer", title: "Open commit" }, code) : code,
    h("span", { class: "tl-commit-msg" }, message));
}

function taskPill(e, tasks) {
  const task = tasks[e.issue_number] || {};
  return h("a", { class: "tl-task", href: `#/task/${e.issue_number}`, style: taskStyle(e.issue_number), title: task.title || "" },
    h("b", {}, `#${e.issue_number}`), task.title ? h("span", {}, task.title) : null);
}

function eventCard(e, tasks) {
  const kind = EVENT_KINDS[e.kind] || EVENT_KINDS.field;
  const compact = e.kind === "commit" || e.kind === "field";
  return h("li", { class: `tl-event ${e.kind}${compact ? " compact" : ""}`, style: taskStyle(e.issue_number) },
    h("time", { class: "tl-when", datetime: e.occurred_at, title: niceTime(e.occurred_at) },
      h("b", {}, e.occurred_at.slice(11, 16)), h("small", {}, ago(e.occurred_at))),
    h("span", { class: "tl-node", "aria-hidden": "true" }, svgIcon(kind.icon, 15)),
    h("article", { class: "tl-card" },
      h("header", {},
        avatar(e.employee, e.photo, e.employee),
        h("span", { class: "tl-who" }, h("strong", {}, e.employee || "Someone"), ` ${kind.verb}`,
          e.kind === "field" ? [" ", h("strong", {}, e.field_name)] : null),
        taskPill(e, tasks)),
      e.kind === "comment" ? commentBody(e) : e.kind === "commit" ? commitLine(e) : changePills(e)));
}

function eventMatches(e, tasks, q) {
  if (!q) return true;
  const hay = `${e.issue_number} ${(tasks[e.issue_number] || {}).title || ""} ${e.employee || ""} ${e.field_name} ${e.old_value || ""} ${e.new_value || ""} ${plainText(e.body)}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

// Modal listing the watched tasks; "Stop watching" here pauses a task (its events stay).
function openWatchlist(initial, onClose) {
  const items = initial.slice();
  const dialog = h("dialog", { class: "tl-dialog", "aria-label": "Watchlist" });
  const list = h("ul", { class: "tl-watch-list" });
  const close = () => dialog.close();
  const draw = () => {
    put(list, items.length ? items.map((w) => h("li", {},
      h("span", { class: "tl-watch-task", style: taskStyle(w.issue_number) }, h("i", { "aria-hidden": "true" }), h("b", {}, `#${w.issue_number}`), h("span", {}, w.title || "")),
      h("small", {}, `${w.events} events`),
      h("button", { type: "button", class: "btn ghost small", onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          await api(`/api/watchlist/${w.issue_number}`, { method: "DELETE", headers: writeHeaders });
          items.splice(items.indexOf(w), 1);
          cache.watched.delete(String(w.issue_number));
          eventsState.issues.delete(w.issue_number);
          draw();
        } catch (error) { ev.currentTarget.disabled = false; toast(error.message, true); }
      } }, "Stop watching")))
      : h("li", { class: "note" }, "No tasks are watched."));
  };
  draw();
  put(dialog, h("header", {}, h("h2", {}, "Watchlist"), h("button", { type: "button", class: "tl-dialog-x", "aria-label": "Close", onclick: close }, "×")),
    h("p", { class: "note" }, "Stopping a watch keeps the recorded events but no longer syncs the task."), list,
    h("footer", {}, h("button", { type: "button", class: "btn", onclick: close }, "Done")));
  dialog.addEventListener("click", (ev) => { if (ev.target === dialog) close(); });
  dialog.addEventListener("close", () => { dialog.remove(); onClose(); });
  document.body.append(dialog);
  dialog.showModal();
}

async function showTimeline(force) {
  const token = ++eventsToken;
  loading(force ? "Syncing watched tasks…" : "Loading the timeline…");
  if (force) {
    try { await api("/api/events/sync", { method: "POST", headers: writeHeaders }); } catch (error) { toast(error.message, true); }
  }
  const query = (before) => {
    const q = new URLSearchParams({ limit: "100", kinds: [...eventsState.kinds].join(",") });
    if (eventsState.issues.size) q.set("issues", [...eventsState.issues].join(","));
    if (before) q.set("before", before);
    return api(`/api/events?${q}`);
  };
  const first = await query();
  if (token !== eventsToken) return;
  const active = first.watchlist.filter((w) => w.active);
  cache.watched = new Set(active.map((w) => String(w.issue_number)));
  // A remembered task that is no longer watched would leave the feed empty.
  for (const issue of [...eventsState.issues]) if (!cache.watched.has(String(issue))) eventsState.issues.delete(issue);
  const redraw = () => { saveFilters(); return showTimeline(false); };

  // ---- summary tiles
  const lastSync = active.map((w) => w.last_synced_at).filter(Boolean).sort().pop();
  const totalEvents = active.reduce((n, w) => n + w.events, 0);
  const tile = (value, label, sub) => h("div", { class: "tl-tile" }, h("b", {}, value), h("span", {}, label), sub ? h("small", {}, sub) : null);
  const errors = active.filter((w) => w.last_error);
  const summary = h("section", { class: "tl-summary", "aria-label": "Summary" },
    tile(active.length, active.length === 1 ? "task watched" : "tasks watched"),
    tile(totalEvents, "events recorded"),
    tile(lastSync ? clock(lastSync) : "—", "last synced", lastSync ? ago(lastSync) : "press Refresh"),
    errors.length ? h("div", { class: "tl-tile bad" }, h("b", {}, "!"), h("span", {}, errors.map((w) => `#${w.issue_number}: ${w.last_error}`).join(" · "))) : null);

  // ---- filters
  const kindFilters = h("div", { class: "tl-kinds", role: "group", "aria-label": "Event types" },
    Object.entries(EVENT_KINDS).map(([key, k]) => h("button", { type: "button", class: `tl-kind ${key}`,
      "aria-pressed": String(eventsState.kinds.has(key)),
      title: key === "commit" ? "Commits linked to the task (hidden by default)" : null,
      onclick: () => { if (eventsState.kinds.has(key)) eventsState.kinds.delete(key); else eventsState.kinds.add(key); redraw(); } },
      svgIcon(k.icon, 14), k.label)));
  const search = h("input", { type: "search", class: "tl-search", placeholder: "Search the loaded events…", "aria-label": "Search events", value: eventsState.q });
  const chips = h("div", { class: "tl-chips", role: "group", "aria-label": "Filter by task" },
    active.map((w) => h("span", { class: "tl-chip", style: taskStyle(w.issue_number) },
      h("button", { type: "button", class: "tl-chip-main", "aria-pressed": String(eventsState.issues.has(w.issue_number)),
        title: w.last_synced_at ? `Show only #${w.issue_number} (synced ${niceTime(w.last_synced_at)})` : `Show only #${w.issue_number}`,
        onclick: () => {
          const wasOn = eventsState.issues.has(w.issue_number);
          eventsState.issues.clear();
          if (!wasOn) eventsState.issues.add(w.issue_number);
          redraw();
        } },
        h("i", { "aria-hidden": "true" }), h("b", {}, `#${w.issue_number}`), h("span", { class: "tl-chip-title" }, w.title || ""), h("small", {}, w.events)))));

  // Watchlist dialog: the only place a task is removed from the watchlist.
  const watchlistButton = h("button", { type: "button", class: "btn ghost", onclick: () => openWatchlist(active, redraw) }, "Watchlist");

  // ---- feed
  const loaded = [];
  const tasks = {};
  let cursor = null;
  const feed = h("ol", { class: "tl-feed" });
  const more = h("div", { class: "tl-footer" });
  const empty = h("div", { class: "tl-empty" });
  const render = () => {
    const q = eventsState.q.trim().toLowerCase();
    const rows = [];
    let day = null, dayCount = 0, header = null;
    const countFor = (date) => loaded.filter((e) => e.occurred_at.startsWith(date) && eventMatches(e, tasks, q)).length;
    for (const e of loaded) {
      if (!eventMatches(e, tasks, q)) continue;
      const date = e.occurred_at.slice(0, 10);
      if (date !== day) {
        day = date;
        rows.push(h("li", { class: "tl-day" }, h("h2", {}, niceDate(date), dayNote(date) ? h("em", {}, dayNote(date)) : null),
          h("span", { class: "tl-count" }, `${countFor(date)} event${countFor(date) === 1 ? "" : "s"}`)));
      }
      rows.push(eventCard(e, tasks));
    }
    put(feed, rows);
    put(empty, rows.length ? null : h("p", { class: "note" }, q ? "No loaded event matches your search." : "No events match these filters."));
    put(more, cursor ? h("button", { type: "button", class: "btn ghost", onclick: async (ev) => {
      ev.currentTarget.disabled = true;
      try { add(await query(cursor)); } catch (error) { toast(error.message, true); }
    } }, "Load older events") : (loaded.length ? h("p", { class: "note" }, "That's the whole history.") : null));
  };
  const add = (page) => { loaded.push(...page.events); Object.assign(tasks, page.tasks); cursor = page.next; render(); };
  search.addEventListener("input", () => { eventsState.q = search.value; render(); });
  add(first);

  if (!active.length) {
    put(view, h("div", { class: "tl-hero" },
      h("div", { class: "tl-hero-star", "aria-hidden": "true" }, "★"),
      h("h2", {}, "Nothing is being watched yet"),
      h("p", {}, "Watch a task and every status change, comment, deadline edit and commit lands here, in time order, across all your tasks."),
      h("a", { class: "btn", href: "#/task" }, "Pick tasks to watch")));
    return;
  }
  put(view, h("div", { class: "tl-page" },
    h("div", { class: "tl-head" }, summary, h("div", { class: "tl-controls" }, kindFilters, search, watchlistButton)),
    chips, feed, empty, more));
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
  // The task's workflow should be at the matching release step.
  const flow = pr.issue_id && cache.workflows && cache.workflows.get(String(pr.issue_id));
  const BEFORE_QA = ["intake", "estimate", "develop", "review", "release_qa"];
  if (flow && flow.state === "active" && pr.base === "qa-release" && BEFORE_QA.includes(flow.step)) {
    notes.push(`Workflow is still at ${flow.step_title}`);
  }
  if (flow && flow.state === "active" && pr.base === "master" && ![ "release_prod", "close", "prod_fix", "release_hotfix"].includes(flow.step)) {
    notes.push(`Workflow is at ${flow.step_title}, not Release to prod`);
  }
  const stage = pr.status && !pr.status.error ? pr.status.stage_status : null;
  return h("article", { class: "card pr" },
    h("div", { class: "head" },
      h("a", { href: pr.url, target: "_blank", rel: "noopener noreferrer", class: "issue" }, `PR ${pr.number} ↗`),
      pr.issue_id ? h("a", { href: `#/task/${pr.issue_id}`, class: "issue" }, `#${pr.issue_id}`) : h("span", { class: "badge" }, "hotfix"),
      h("span", { class: `badge ${VERDICT_CLASS[pr.verdict]}` }, pr.verdict),
      flow ? h("a", { href: `#/task/${pr.issue_id}`, class: `pill ${flow.status.code}`, title: flow.status.label }, flow.status.short) : null),
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
    await getWorkflows(true);
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

// ---- worktrees -------------------------------------------------------------
// Each workflow works in its own git worktree of the task's repo.
async function getBoards() {
  if (!cache.boards) cache.boards = (await api("/api/work/config").catch(() => ({ boards: {} }))).boards;
  return cache.boards;
}

function toast(text, isError) {
  const el = h("div", { class: `toast${isError ? " bad" : ""}`, role: "status" }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), isError ? 9000 : 6000);
}

// The workflow badge on a board card, task row or worktree: where the task's
// workflow stands (from /api/workflows), linking to the task page, which is
// the only place a step is run or decided.
async function getWorkflows(force) {
  if (!cache.workflows || force) {
    const r = await api("/api/workflows").catch(() => ({ workflows: [] }));
    cache.workflows = new Map(r.workflows.map((w) => [String(w.issue), w]));
  }
  return cache.workflows;
}

function workflowLink(issue, code, boards) {
  const flow = cache.workflows && cache.workflows.get(String(issue));
  if (!flow && (!code || !boards[String(code)])) return null;
  return h("a", {
    class: `start wf-${flow ? flow.status.code : "none"}`,
    href: `#/task/${issue}`,
    title: flow ? `Workflow: ${flow.status.label}` : `No workflow yet · ${boards[String(code)]}`,
  }, flow ? flow.status.short : "+ Workflow");
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
  const [{ worktrees }, boards] = await Promise.all([api("/api/work/worktrees"), getBoards(), getWorkflows(true)]);
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
        w.issue_id ? workflowLink(w.issue_id, w.code, boards) : null, remove, both));
  });
  put(view,
    h("p", { class: "summary" }, h("strong", {}, String(worktrees.length)), ` task worktree${worktrees.length === 1 ? "" : "s"} · ${sizeText(total)}`),
    worktrees.length
      ? h("table", { class: "work" },
        h("thead", {}, h("tr", {}, ["Task", "Branch", "Size", "State", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, rows))
      : h("p", { class: "note" }, "No task worktrees. Starting a workflow on a task page makes one."),
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

// The first few faces, then "+N" naming the rest, so a busy task can't spill into the next column.
const MAX_FACES = 6;
function people(subscribers) {
  const shown = subscribers.slice(0, MAX_FACES), rest = subscribers.slice(MAX_FACES);
  return h("span", { class: "people" },
    shown.map((p) => avatar(p.name, p.photo, p.name)),
    rest.length ? h("span", { class: "avatar more", title: rest.map((p) => p.name).join(", ") }, `+${rest.length}`) : null);
}

function taskRow(t, boards) {
  return h("a", { class: "trow", href: `#/task/${t.issue_number}` },
    watchButton(t.issue_number),
    h("span", { class: "issue" }, `#${t.issue_number}`),
    h("div", { class: "ttitle" },
      h("span", { class: "tname" }, t.title),
      t.tags.length ? h("span", { class: "tags" }, t.tags.map(tagChip)) : null),
    rail(t),
    h("span", { class: "stage" }, t.stage_status || "–"),
    h("span", { class: "tdue" }, t.deadline ? niceDate(t.deadline, false) : "–", flagBadge(t.deadline_flag)),
    h("span", { class: "thours" }, hoursText(t)),
    people(t.subscribers),
    h("span", { class: "tact" }, workflowLink(t.issue_number, t.code, boards)));
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
  await Promise.all([loadWatched(), getWorkflows(refresh)]);
  const body = h("div", { class: "mytasks" });
  put(view, body);
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
          h("span"), h("span"), h("span", {}, "Task"), railKey(), h("span", {}, "Stage"), h("span", {}, "Due"), h("span", {}, "Hours"), h("span", {}, "People"), h("span")) : null,
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
      h("div", { class: "list-head" },
        h("div", { class: "list-title" }, h("h2", {}, "My tasks"), projectPicker, summary),
        h("div", { class: "list-tools" },
          h("div", { class: "filters" }, search, select("All tags", tagNames, "tag"), select("All stages", stageNames, "stage"),
            h("label", { class: "check" }, overdue, " Overdue only")),
          toolbar)),
      h("nav", { class: "subtabs", "aria-label": "Task tabs" }, data.tabs.map((t) => h("button", {
        type: "button", class: "subtab", "aria-current": t.name === data.tab ? "page" : null, onclick: () => load(t.name),
      }, t.name, h("span", { class: "count" }, t.count)))),
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
    h("div", { class: "head-info" },
    h("div", { class: "title-line" },
      h("span", { class: "issue" }, `#${task.issue_id}`),
      h("h2", {}, task.title || "(no title)")),
    h("div", { class: "facts" },
      status && !status.error ? h("span", {}, status.stage_status) : null,
      task.creator ? h("span", {}, `Created by ${task.creator}`) : null,
      task.created_date ? h("span", {}, niceDate(task.created_date, false)) : null,
      task.tags.length ? h("span", {}, `Tags: ${task.tags.join(", ")}`) : null,
      link ? h("a", { href: link, target: "_blank", rel: "noopener noreferrer" }, "Open in Timeline ↗") : null)),
    h("div", { class: "head-stages" },
      toolbar,
      railKey(),
      rail(status && !status.error ? status : null)));
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
  const listed = [...cache.projectTasks.values()].flatMap((d) => d.groups.flatMap((g) => g.tasks))
    .find((t) => String(t.issue_number) === String(task.issue_id));
  const flow = h("section", { class: "wf", "aria-label": "Workflow" }, h("p", { class: "note" }, "Loading the workflow…"));
  put(view,
    head,
    flow,
    h("h3", { class: "task-section" }, "Description"),
    h("ol", { class: "comments" }, post(task.creator, task.created_date ? niceDate(task.created_date, false) : "",
      description ? richText(task.description) : h("p", { class: "note" }, "No description."), "task creator", description, photos.get(task.creator))),
    h("h3", { class: "task-section" }, `Conversation (${task.comments.length})`),
    comments.length ? h("ol", { class: "comments" }, comments) : h("p", { class: "note" }, "No comments yet."));
  await loadWorkflow(flow, String(task.issue_id), (planned && planned.code) || (listed && listed.code) || null);
}

// ---- task workflow ---------------------------------------------------------
// The flow, its status and history come from /api/workflow/<id> (workflow.py),
// including which buttons apply now: the page shows them and asks for the
// reasons, the server decides. Only Run and Continue open Claude, in a
// terminal; every decision is saved with its time.
const flowState = { token: 0, timer: null, open: new Set(), resetting: false };

const EVENT_LABEL = {
  start: "Started", run: "Ran", resume: "Continued", approve: "Approved", reject: "Rejected", abandon: "Abandoned",
  skip: "Skipped", finish: "Finished", back_to_develop: "Back to Develop", qa_issues: "QA found issues",
  qa_passed: "QA approved", close: "Closed", stop: "Stopped", reopen: "Reopened",
  ack: "Marked Timeline changes as seen", finding: "Finding", finding_added: "Added finding", prod_fix: "Started a prod fix",
  answer: "Answered", stop_run: "Stopped run", message: "Wrote to Claude", permission: "Tool call", reset: "Reset",
};

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function flowPost(issue, path, body) {
  return api(`/api/workflow/${encodeURIComponent(issue)}/${path}`, {
    method: "POST",
    headers: { "X-Timeline-Desk": "1", "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

async function loadWorkflow(el, issue, code) {
  const token = ++flowState.token;
  clearTimeout(flowState.timer);
  let v;
  try {
    v = await api(`/api/workflow/${encodeURIComponent(issue)}${code ? `?code=${encodeURIComponent(code)}` : ""}`);
  } catch (error) {
    put(el, h("p", { class: "error", role: "alert" }, `Workflow: ${error.message}`));
    return;
  }
  if (token !== flowState.token || !el.isConnected) return;
  renderWorkflow(el, v, code);
  if (cache.workflows) {  // keep the badges elsewhere in step
    if (v.workflow) cache.workflows.set(issue, { issue, code: v.workflow.code, step: v.workflow.step, status: v.status });
    else cache.workflows.delete(issue);
  }
  // While Claude is working, look again now and then: every 3 s for a run on
  // this page (live output), every 10 s for one in a terminal.
  const running = v.runs.filter((r) => r.status === "running" || r.status === "approval" || (r.mode === "agent" && r.live && !r.decision));
  if (running.length) {
    const wait = running.some((r) => r.mode === "agent") ? 2000 : running.some((r) => r.mode === "desk") ? 3000 : 10000;
    flowState.timer = setTimeout(() => { if (el.isConnected) loadWorkflow(el, issue, code); }, wait);
  }
}

function stepper(steps) {
  return h("ol", { class: "wf-steps" }, steps.filter((s) => !s.hidden).map((s) => h("li", { class: `wf-step ${s.state}`, title: `${s.title}: ${s.state}` },
    h("span", { class: "dot", "aria-hidden": "true" }), s.title,
    s.optional ? h("small", {}, " optional") : null)));
}

function factList(rows) {
  return h("dl", { class: "wf-facts" }, rows.filter(([, value]) => value && (!Array.isArray(value) || value.length))
    .flatMap(([label, value]) => [h("dt", {}, label),
      h("dd", {}, Array.isArray(value) ? h("ul", {}, value.map((x) => h("li", {}, x))) : value)]));
}

function resultBlock(run) {
  const r = run.result;
  if (!r) {
    return h("p", { class: "note" }, run.status === "running"
      ? (run.mode === "agent"
        ? "Claude is working inside the desk. Every edit and command it wants waits for you under Approvals; write to it in the box below."
        : run.mode === "desk"
        ? "Claude is working in the background on this page; its output shows under Conversation and updates every few seconds."
        : `Claude is working in the terminal. It reports back in ${run.result_file}; this page checks every 10 seconds.`)
      : `No result in ${run.result_file}.${run.exit_code !== null && run.exit_code !== undefined ? ` Claude exited with code ${run.exit_code}.` : ""}`);
  }
  return h("div", { class: "wf-result" },
    r.error ? h("p", { class: "error" }, r.error) : null,
    r.summary ? markdown(r.summary) : null,
    factList([
      ["Questions", r.questions],
      ["Files", r.files],
      ["Commits", r.commits],
      ["Left after this", r.remaining !== undefined ? String(r.remaining) : null],
    ]));
}

function conversation(issue, run) {
  const box = h("div", { class: "wf-convo" }, h("p", { class: "note" }, "Loading…"));
  const details = h("details", { class: "wf-more" }, h("summary", {}, "Conversation"), box);
  const key = `convo-${run.id}`;
  const load = async () => {
    try {
      const t = await api(`/api/workflow/${encodeURIComponent(issue)}/runs/${run.id}/transcript`);
      if (!t.found) { put(box, h("p", { class: "note" }, `No session log for ${t.session_id} yet. Claude Code writes it once the session starts.`)); return; }
      put(box,
        t.truncated ? h("p", { class: "note" }, "Showing the latest part only.") : null,
        t.items.length ? t.items.map((i) => h("div", { class: `msg ${i.who}` },
          h("span", { class: "who" }, { you: "You", claude: "Claude", desk: "Desk" }[i.who] || "Tool"),
          i.who === "claude" ? markdown(i.text) : h("div", { class: "text" }, i.text))) : h("p", { class: "note" }, "Nothing said yet."));
    } catch (error) {
      put(box, h("p", { class: "error" }, error.message));
    }
  };
  details.addEventListener("toggle", () => {
    if (details.open) { flowState.open.add(key); load(); } else flowState.open.delete(key);
  });
  // A run working on this page shows its output without being asked.
  if ((run.mode === "desk" || run.mode === "agent") && !run.decision && !flowState.open.has(`closed-${key}`)) flowState.open.add(key);
  details.addEventListener("toggle", () => { if (!details.open) flowState.open.add(`closed-${key}`); });
  if (flowState.open.has(key)) { details.open = true; load(); }
  return details;
}

// Approvals (phase 5): tool calls a run inside the desk is waiting on.
function permissionsBox(el, issue, code, v) {
  if (!v.permissions.length) return null;
  const decide = async (p, decision, button) => {
    let note = "";
    if (decision === "deny") {
      note = window.prompt(`Deny "${p.summary}": why? (Claude reads this and does something else)`);
      if (note === null) return;
      if (!note.trim()) { toast("Say why you deny it.", true); return; }
    }
    button.disabled = true;
    try { await flowPost(issue, `permissions/${p.id}`, { decision, note }); } catch (error) { toast(error.message, true); }
    await loadWorkflow(el, issue, code);
  };
  const detail = (d) => {
    if (d.command) return h("pre", { class: "md-code" }, d.command + (d.description ? `\n# ${d.description}` : ""));
    if (d.old_string !== undefined || d.new_string !== undefined) {
      return h("div", { class: "wf-diff" },
        d.file_path ? h("p", { class: "note" }, d.file_path) : null,
        h("pre", { class: "md-code old" }, d.old_string || ""), h("pre", { class: "md-code new" }, d.new_string || ""));
    }
    if (d.content !== undefined) return h("div", {}, d.file_path ? h("p", { class: "note" }, d.file_path) : null, h("pre", { class: "md-code new" }, d.content));
    return h("pre", { class: "md-code" }, JSON.stringify(d, null, 2));
  };
  const pending = v.permissions.filter((p) => p.status === "pending");
  const done = v.permissions.filter((p) => p.status !== "pending");
  return h("div", { class: "wf-card wf-approvals" },
    h("h4", {}, pending.length ? `Approvals (${pending.length} waiting)` : "Approvals"),
    pending.map((p) => {
      const allow = h("button", { type: "button", class: "btn" }, "Allow");
      const deny = h("button", { type: "button", class: "btn ghost" }, "Deny");
      allow.addEventListener("click", () => decide(p, "allow", allow));
      deny.addEventListener("click", () => decide(p, "deny", deny));
      return h("div", { class: "permission" }, h("strong", {}, p.summary), detail(p.detail), h("div", { class: "wf-actions" }, allow, deny));
    }),
    done.length ? h("details", { class: "wf-more" }, h("summary", {}, `Decided (${done.length})`),
      h("ul", { class: "wf-log" }, done.map((p) => h("li", {}, h("small", {}, when(p.decided_at)),
        h("strong", {}, p.status), ` ${p.summary}`, p.note ? h("div", { class: "text" }, p.note) : null)))) : null);
}

function messageBox(el, issue, code, run) {
  const input = h("textarea", { rows: "2", placeholder: "Go ahead with step 2, but keep the old column name", "aria-label": "Message to Claude" });
  const send = h("button", { type: "button", class: "btn" }, "Send");
  send.addEventListener("click", async () => {
    if (!input.value.trim()) { toast("Write a message first.", true); return; }
    send.disabled = true;
    try { await flowPost(issue, "message", { run_id: run.id, text: input.value }); input.value = ""; }
    catch (error) { toast(error.message, true); }
    await loadWorkflow(el, issue, code);
  });
  return h("div", { class: "wf-message" }, input, send);
}

function runCard(issue, run, open) {
  return h("article", { class: `wf-run ${open ? "open" : ""}` },
    h("div", { class: "wf-run-head" },
      h("strong", {}, `Run ${run.id} · ${run.step_title}`),
      h("span", { class: `pill ${run.status}` }, run.status_label),
      h("span", { class: "note" }, run.mode === "desk" ? "on this page" : run.mode === "agent" ? "inside the desk, with approvals" : "in a terminal"),
      run.finding_id ? h("span", { class: "note" }, `F${run.finding_id}`) : null,
      h("small", {}, `${when(run.started_at)}${run.ended_at ? ` – ${when(run.ended_at)}` : ""}`)),
    resultBlock(run),
    run.note ? h("p", { class: "note" }, `Your note: ${run.note}`) : null,
    h("details", { class: "wf-more" }, h("summary", {}, "Prompt and session"),
      factList([["Session", run.session_id], ["Folder", run.cwd], ["Result file", run.result_file]]),
      h("pre", { class: "md-code" }, run.prompt)),
    conversation(issue, run));
}

async function act(el, issue, code, action, v) {
  const open = v.runs.find((r) => !r.decision);
  if (action.kind === "reset") {  // opens the form below the buttons
    flowState.resetting = !flowState.resetting;
    renderWorkflow(el, v, code);
    return;
  }
  let note = "";
  if (action.kind === "answer") {
    const answer = window.prompt(`Your answer for run ${open.id} (it carries on here on the page):`);
    if (answer === null) return;
    if (!answer.trim()) { toast("Write your answer first.", true); return; }
    try { await flowPost(issue, "answer", { run_id: open.id, answer }); toast("Answer sent; the run carries on below."); }
    catch (error) { toast(error.message, true); }
    await loadWorkflow(el, issue, code);
    return;
  }
  if (action.kind === "stop_run") {
    if (!window.confirm(`Stop run ${open.id}? It's recorded as rejected.`)) return;
    try { await flowPost(issue, "stop-run", { run_id: open.id }); } catch (error) { toast(error.message, true); }
    await loadWorkflow(el, issue, code);
    return;
  }
  if (action.kind === "approve") {
    const step = v.steps.find((s) => s.key === v.workflow.step);
    if (!window.confirm(`Approve run ${open.id} of ${step.title}?\n\nYou confirm: ${step.approve}`)) return;
  } else if (action.needs_note) {
    note = window.prompt(`${action.label}: why? (saved in the history)`);
    if (note === null) return;
    if (!note.trim()) { toast("Add a reason, so the history says why.", true); return; }
  } else if (["run", "run_terminal", "run_agent", "resume", "ack"].includes(action.kind)) {
    // no extra question: the step card above (or the Timeline box) is what this acts on
  } else if (!window.confirm(`${action.label}?\n\n${action.help}`)) return;
  try {
    const runs = ["run", "run_terminal", "run_agent", "explain_blocker"].includes(action.kind);
    const path = runs ? "run" : action.kind === "resume" ? "resume" : "decide";
    const body = action.kind === "run" ? {} : action.kind === "run_terminal" ? { mode: "terminal" }
      : action.kind === "run_agent" ? { mode: "agent" }
      : action.kind === "explain_blocker" ? { side: "unblock" }
      : action.kind === "resume" ? { run_id: open.id }
      : { kind: action.kind, run_id: open ? open.id : null, note };
    const r = await flowPost(issue, path, body);
    if (runs) {
      const where = r.started.mode === "desk" ? "is working on this page"
        : r.started.mode === "agent" ? "is working inside the desk; approve its tool calls here" : "opened in a terminal";
      toast(`Claude ${where} for run ${r.started.run_id}.${r.note ? ` ${r.note}` : ""}`, Boolean(r.note));
    }
    else if (action.kind === "resume") toast("Claude reopened in a terminal.");
  } catch (error) {
    toast(error.message, true);
  }
  await loadWorkflow(el, issue, code);
}

// Reset: erase the task's workflow and its timeline/<id>/ folder, after you type the task number.
function resetForm(el, issue, code, v) {
  if (!flowState.resetting || !v.actions.some((a) => a.kind === "reset") || !v.reset_preview) return null;
  const p = v.reset_preview;
  const files = p.folders.flatMap((f) => f.files.map((name) => `${f.path}/${name}`));
  const typed = h("input", { type: "text", inputmode: "numeric", placeholder: issue, "aria-label": `Type ${issue} to confirm`, maxlength: "8" });
  const go = h("button", { type: "button", class: "btn danger" }, "Erase and reset");
  const cancel = h("button", { type: "button", class: "btn ghost" }, "Cancel");
  const open = v.runs.find((r) => !r.decision);
  cancel.addEventListener("click", () => { flowState.resetting = false; renderWorkflow(el, v, code); });
  go.addEventListener("click", async () => {
    if (typed.value.trim().replace(/^#/, "") !== issue) { toast(`Type ${issue} to confirm.`, true); typed.focus(); return; }
    go.disabled = true;
    try {
      const r = await flowPost(issue, "reset", { confirm: typed.value, code });
      flowState.resetting = false;
      toast(`#${issue} reset: ${r.removed.runs} run(s), ${r.removed.findings} finding(s) and ${r.removed.files} file(s) erased.`);
    } catch (error) {
      toast(error.message, true);
      go.disabled = false;
      return;
    }
    await loadWorkflow(el, issue, code);
  });
  return h("div", { class: "wf-card wf-reset" },
    h("h4", {}, `Reset #${issue}: erase everything`),
    h("p", {}, "This deletes, and it can't be undone:"),
    h("ul", {},
      h("li", {}, `The workflow's status, ${p.runs} run(s) with their results and conversations, every decision, ${p.findings} QA finding(s) and all approval requests.`),
      h("li", {}, files.length ? `${files.length} file(s) in ${p.folders.map((f) => f.path).join(" and ")}:` : "No files in the task's timeline folder."),
      files.length ? h("details", { class: "wf-more" }, h("summary", {}, "Show the files"), h("pre", { class: "md-code" }, files.join("\n"))) : null),
    h("p", { class: "note" }, `Kept: the worktree ${p.worktree || ""} and its branch ${p.branch || ""} (remove them on the Work tab), and the copied Timeline history.`,
      open ? ` Run ${open.id} is open: a run on this page is stopped first; a terminal run must be closed before you reset.` : ""),
    h("div", { class: "wf-actions" }, h("label", { class: "note" }, `Type ${issue} to confirm `, typed), go, cancel));
}

function actionBar(el, issue, code, v) {
  if (!v.actions.length) return null;
  return h("div", { class: "wf-actions" }, v.actions.map((a) => {
    if (a.kind === "message") return null;  // the run card has its own message box
    const primary = ["run", "approve", "close", "reopen", "answer"].includes(a.kind) || a.suggested;
    const button = h("button", {
      type: "button",
      class: `btn${primary ? "" : " ghost"}${a.kind === "stop" ? " far" : ""}${a.suggested ? " suggested" : ""}`,
      title: a.blocked || (a.suggested ? `Suggested by a Timeline change. ${a.help}` : a.help),
      disabled: a.blocked ? true : null,
    }, a.label);
    button.addEventListener("click", async () => {
      button.disabled = true;
      await act(el, issue, code, a, v);
    });
    return button;
  }), v.actions.find((a) => a.blocked) ? h("p", { class: "warn-text" }, v.actions.find((a) => a.blocked).blocked) : null);
}

function stepCard(v) {
  const step = v.steps.find((s) => s.key === v.workflow.step);
  if (v.workflow.state !== "active") return null;
  return h("div", { class: "wf-card" },
    h("h4", {}, `Now: ${step.title}`, step.repeat ? h("small", {}, " · one item per run, repeat until done") : null),
    step.about ? h("p", {}, step.about) : null,
    step.run ? factList([
      ["Skills", step.skills],
      ["Reads", step.reads],
      ["Writes", step.writes],
      ["Won't", step.wont],
      ["Runs in", step.runner === "desk"
        ? `This page, in the background, in ${v.workflow.worktree || "the task's worktree"}: read-only tools, writes only timeline/${v.issue}/ (or run it in a terminal instead)`
        : `A terminal, in ${v.workflow.worktree || "the task's worktree"}, with Claude's normal permission prompts`],
      ["You approve", step.approve],
    ]) : null,
    v.prompt_note ? h("p", { class: "note" }, v.prompt_note) : null,
    v.prompt_preview ? h("details", { class: "wf-more" }, h("summary", {}, "Exact prompt"),
      h("p", { class: "note" }, "<run> becomes the run number."), h("pre", { class: "md-code" }, v.prompt_preview)) : null);
}

function docsList(issue, code, v) {
  if (!v.docs.length) return h("p", { class: "note" }, `No task docs yet in ${v.repo || "the repo"}'s timeline/${issue}/.`);
  const shown = h("div", { class: "wf-doc" });
  return h("div", {},
    h("ul", { class: "wf-docs" }, v.docs.map((d) => h("li", {},
      h("button", {
        type: "button", class: "linkish",
        onclick: async () => {
          put(shown, h("p", { class: "note" }, `Loading ${d.name}…`));
          try {
            const doc = await api(`/api/workflow/${encodeURIComponent(issue)}/doc/${encodeURIComponent(d.name)}${code ? `?code=${encodeURIComponent(code)}` : ""}`);
            const copy = h("button", { type: "button", class: "btn ghost small" }, "Copy");
            copy.addEventListener("click", async () => {
              try { await navigator.clipboard.writeText(doc.text); toast(`Copied ${doc.name}.`); }
              catch { toast("Couldn't copy — clipboard not available.", true); }
            });
            put(shown, h("div", { class: "wf-doc-head" }, h("strong", {}, doc.name), h("small", {}, `changed ${when(doc.modified)}`), copy),
              /\.md$/.test(doc.name) ? markdown(doc.text) : h("pre", { class: "md-code" }, doc.text));
          } catch (error) {
            put(shown, h("p", { class: "error" }, error.message));
          }
        },
      }, d.name),
      h("small", {}, ` ${when(d.modified)}`)))),
    shown);
}

function startForm(el, issue, code, v) {
  if (!v.startable) return h("p", { class: "note" }, v.start_note);
  const select = h("select", { "aria-label": "Start at" }, v.steps.filter((s) => s.key !== "close" && !s.hidden)
    .map((s) => h("option", { value: s.key, selected: s.key === v.proposal.step ? true : null }, s.title)));
  const button = h("button", { type: "button", class: "btn" }, "Start workflow");
  button.addEventListener("click", async () => {
    const step = v.steps.find((s) => s.key === select.value);
    if (!window.confirm(`Start a workflow for #${issue} at ${step.title}?\n\nThe desk makes or reuses the task's worktree in ${v.repo}. Steps before ${step.title} are recorded as skipped.`)) return;
    button.disabled = true;
    try {
      const r = await flowPost(issue, "start", { code: v.code, step: select.value });
      if (r.note) toast(r.note, true);
    } catch (error) {
      toast(error.message, true);
    }
    await loadWorkflow(el, issue, code);
  });
  return h("div", { class: "wf-card" },
    h("h4", {}, "Start a workflow"),
    h("p", {}, `Suggested start: ${v.steps.find((s) => s.key === v.proposal.step).title}. `, h("span", { class: "note" }, v.proposal.reason)),
    v.timeline_error ? h("p", { class: "warn-text" }, `Couldn't read Timeline's stages: ${v.timeline_error}`) : null,
    h("div", { class: "wf-actions" }, h("label", { class: "note" }, "Start at ", select), button),
    h("p", { class: "note" }, `Nothing runs until you click Run on a step. Every run and decision is kept in the history below.`));
}

// QA findings (phase 3): each QA comment (or a point you add) with your
// verdict. Only Bug findings get fixed, one per run; Questions get a drafted reply.
const FINDING_BUTTON = { bug: "Bug", question: "Question", not_bug: "Not a bug", wont_fix: "Won't fix", new: "Undecided" };

function findingsBox(el, issue, code, v) {
  const inQa = v.workflow && ["qa", "qa_fix"].includes(v.workflow.step) && v.workflow.state === "active";
  if (!v.findings.length && !inQa) return null;
  const after = () => loadWorkflow(el, issue, code);
  const post = async (path, body, okText) => {
    try { await flowPost(issue, path, body); if (okText) toast(okText); } catch (error) { toast(error.message, true); }
    await after();
  };
  const rows = v.findings.map((f) => {
    const classify = f.classify.map((target) => {
      const b = h("button", { type: "button", class: "btn ghost small" }, FINDING_BUTTON[target] || target);
      b.addEventListener("click", async () => {
        let note = "";
        if (["question", "not_bug", "wont_fix"].includes(target) || f.status === "fixed") {
          note = window.prompt(`F${f.id} → ${FINDING_BUTTON[target]}: why? (saved in the history)`);
          if (note === null) return;
          if (!note.trim()) { toast("Add a reason, so the history says why.", true); return; }
        }
        b.disabled = true;
        await post(`findings/${f.id}`, { status: target, note });
      });
      return b;
    });
    const fix = f.can_fix ? h("button", { type: "button", class: "btn small" }, "Fix this") : null;
    if (fix) fix.addEventListener("click", async () => { fix.disabled = true; await post("run", { finding_id: f.id }, `Claude opened in a terminal for F${f.id}.`); });
    const reply = f.can_reply ? h("button", { type: "button", class: "btn small" }, "Draft a reply") : null;
    if (reply) reply.addEventListener("click", async () => { reply.disabled = true; await post("run", { side: "qa_reply", finding_id: f.id }, `Claude opened in a terminal to draft a reply for F${f.id}.`); });
    const body = plainText(f.body);
    return h("li", { class: `finding ${f.status}` },
      h("div", { class: "finding-head" },
        h("strong", {}, `F${f.id}`),
        h("span", { class: `pill ${f.status === "fixed" ? "done" : f.status === "bug" ? "needs_you" : f.status === "new" ? "attention" : "none"}` }, f.status_label),
        h("span", { class: "note" }, [f.author, f.posted_at && f.posted_at.replace("T", " ").slice(0, 16), f.event_id && `comment ${f.event_id}`,
          `QA round ${f.qa_round + 1}`, f.run_id && `fixed in run ${f.run_id}`].filter(Boolean).join(" · "))),
      f.label ? h("p", {}, f.label) : null,
      body ? h("details", { class: "wf-more" }, h("summary", {}, body.length > 140 ? `${body.slice(0, 140)}…` : body), richText(f.body)) : null,
      f.note ? h("p", { class: "note" }, `Your note: ${f.note}`) : null,
      h("div", { class: "wf-actions" }, fix, reply, classify));
  });
  let add = null;
  if (inQa) {
    const input = h("input", { type: "text", placeholder: "Totals row is misaligned on the PDF", "aria-label": "New finding", maxlength: "300" });
    const button = h("button", { type: "button", class: "btn ghost small" }, "Add finding");
    button.addEventListener("click", async () => {
      if (!input.value.trim()) { toast("Describe the finding in a few words.", true); return; }
      button.disabled = true;
      await post("findings", { label: input.value });
    });
    add = h("div", { class: "wf-actions" }, input, button);
  }
  const open = v.findings.filter((f) => f.status === "new" || f.status === "bug").length;
  return h("div", { class: "wf-card wf-findings" },
    h("h4", {}, `QA findings (${v.findings.length})`, open ? h("small", {}, ` · ${open} to decide or fix`) : null),
    v.findings.length ? h("ul", {}, rows) : h("p", { class: "note" }, "No QA comments yet. They appear here as Timeline syncs (every few minutes)."),
    add);
}

// What changed in Timeline since you last marked it seen (phase 2 signals).
function timelineBox(v) {
  const hints = [];
  if (!v.watched) hints.push("This task isn't on the watchlist, so Timeline changes aren't followed. Start the workflow again or watch it on the Task tab.");
  if (!v.me) hints.push('Set "me" in timeline-desk.json to your Timeline name, so your own comments aren\'t counted.');
  if (!v.signals.length && !v.blocked && !hints.length) return null;
  return h("div", { class: `wf-signals${v.signals.some((s) => s.level !== "info") ? " loud" : ""}` },
    h("h4", {}, v.signals.length ? `New in Timeline (${v.signals.length})` : "Timeline"),
    v.blocked ? h("p", { class: "warn-text" }, `Timeline's latest stage: ${v.blocked}.`) : null,
    v.signals.length ? h("ul", {}, v.signals.map((s) => h("li", { class: s.level },
      h("small", {}, s.at ? s.at.replace("T", " ").slice(0, 16) : ""), " ", s.text,
      s.suggest ? h("span", { class: "note" }, ` → suggests ${(ACTION_LABEL[s.suggest] || s.suggest)}`) : null))) : null,
    hints.map((t) => h("p", { class: "note" }, t)));
}

const ACTION_LABEL = { qa_issues: "QA found issues", qa_passed: "QA approved", explain_blocker: "Explain the blocker" };

function renderWorkflow(el, v, code) {
  const issue = v.issue;
  if (!v.workflow) {
    put(el, h("div", { class: "wf-head" }, h("h3", {}, "Workflow"), h("span", { class: "pill none" }, "Not started")),
      stepper(v.steps), startForm(el, issue, code, v),
      h("h4", {}, "Task docs"), docsList(issue, code, v));
    return;
  }
  const w = v.workflow;
  const open = v.runs.find((r) => !r.decision);
  put(el,
    h("div", { class: "wf-head" },
      h("h3", {}, "Workflow"),
      h("span", { class: `pill ${v.status.code}` }, v.status.label),
      h("span", { class: "note" }, [w.repo, w.branch && `branch ${w.branch}`, w.qa_round ? `QA round ${w.qa_round + 1}` : null,
        `started ${when(w.started_at)}`].filter(Boolean).join(" · "))),
    stepper(v.steps),
    timelineBox(v),
    stepCard(v),
    findingsBox(el, issue, code, v),
    open ? runCard(issue, open, true) : null,
    open ? permissionsBox(el, issue, code, v) : null,
    open && v.actions.some((a) => a.kind === "message") ? messageBox(el, issue, code, open) : null,
    actionBar(el, issue, code, v),
    resetForm(el, issue, code, v),
    h("details", { class: "wf-section", open: v.runs.length && !open ? true : null },
      h("summary", {}, `Runs (${v.runs.length})`),
      v.runs.length ? v.runs.filter((r) => r !== open).map((r) => runCard(issue, r, false)) : h("p", { class: "note" }, "No runs yet.")),
    h("details", { class: "wf-section" }, h("summary", {}, `Decisions (${v.events.length})`),
      h("ol", { class: "wf-log" }, v.events.map((e) => h("li", {},
        h("small", {}, when(e.at)), h("strong", {}, EVENT_LABEL[e.kind] || e.kind),
        e.step ? h("span", { class: "note" }, ` · ${(v.steps.find((s) => s.key === e.step) || {}).title || e.step}`) : null,
        e.run_id ? h("span", { class: "note" }, ` · run ${e.run_id}`) : null,
        e.note ? h("div", { class: "text" }, e.note) : null)))),
    h("details", { class: "wf-section", open: true }, h("summary", {}, `Task docs (${v.docs.length})`), docsList(issue, code, v)));
}

// ---- workflows overview -----------------------------------------------------
// Every task workflow, grouped by what it needs: you, Claude, QA, or nothing.
const FLOW_GROUPS = [
  { key: "you", label: "Needs you", codes: ["attention", "needs_you"] },
  { key: "running", label: "Running", codes: ["running"] },
  { key: "waiting", label: "Waiting on QA", codes: ["waiting"] },
  { key: "stopped", label: "Stopped", codes: ["stopped"] },
  { key: "done", label: "Done", codes: ["done"] },
];

async function showWorkflows() {
  loading("Loading workflows…");
  const { workflows } = await api("/api/workflows");
  cache.workflows = new Map(workflows.map((w) => [String(w.issue), w]));
  if (!workflows.length) {
    put(view, h("p", { class: "note" }, "No workflows yet. Open a task (from the planner or the Task tab) and start one."));
    return;
  }
  const row = (w) => h("a", { class: "wf-row", href: `#/task/${w.issue}` },
    h("span", { class: "issue" }, `#${w.issue}`),
    h("span", { class: "ttitle" }, h("span", { class: "tname" }, w.title || "(no title)"),
      w.newest_signal ? h("small", { class: "note" }, w.newest_signal.text) : null),
    h("span", { class: `pill ${w.status.code}` }, w.status.label.length > 60 ? w.status.short : w.status.label),
    h("small", { class: "note" }, `since ${when(w.step_since || w.updated_at)}`));
  put(view, ...FLOW_GROUPS.map((g) => {
    const items = workflows.filter((w) => g.codes.includes(w.status.code));
    if (!items.length) return null;
    return h("section", { class: "wf-group" }, h("h3", { class: "task-section" }, `${g.label} (${items.length})`), items.map(row));
  }));
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
    else if (name === "timeline") await showTimeline(force);
    else if (name === "release") await showRelease(force);
    else if (name === "work") await showWork();
    else if (name === "workflows") await showWorkflows();
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
  cache.workflows = null;
  await route(true);
  getPlanner().catch(() => {});
});

window.addEventListener("hashchange", () => route(false));
route(false);
if (!/^#\/(planner|board)/.test(location.hash) && location.hash) getPlanner().catch(() => {});
