import { parseOrg } from "./org/parser.ts";
import { generateWeek, collectDeadlines, collectOverdueItems, collectSomedayItems } from "./agenda/generate.ts";
import { renderAgenda } from "./ui/render.ts";
import { getTagColor, setTagColor, resetTagColor } from "./ui/tagColors.ts";

// ── Constants ───────────────────────────────────────────────────────

const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MB

// ── State ────────────────────────────────────────────────────────────

let entries = parseOrg("");
let currentStart = todayMidnight();
let currentSource = localStorage.getItem("mediant-org-source") ?? "";
let serverMode = false;
let serverVersion: string | null = null;
let agendaLoaded = false;

// ── Tag editor panel ────────────────────────────────────────────────

let panelEl: HTMLElement | null = null;
let overlayEl: HTMLElement | null = null;

function buildTagEditorPanel(): void {
  overlayEl = document.createElement("div");
  overlayEl.className = "te-overlay";
  overlayEl.addEventListener("click", closeTagEditor);

  panelEl = document.createElement("aside");
  panelEl.className = "te-panel";

  const header = document.createElement("div");
  header.className = "te-header";

  const title = document.createElement("span");
  title.textContent = "Tag colors";

  const closeBtn = document.createElement("button");
  closeBtn.className = "te-close";
  closeBtn.textContent = "\u00D7";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", closeTagEditor);

  header.append(title, closeBtn);
  panelEl.appendChild(header);

  document.body.append(overlayEl, panelEl);
}

/** Collect every unique tag from the current parsed entries. */
function collectAllTags(): string[] {
  const tags = new Set<string>();
  for (const entry of entries) {
    for (const tag of entry.tags) tags.add(tag);
  }
  return [...tags].sort();
}

function openTagEditor(): void {
  if (!panelEl || !overlayEl) return;

  // Rebuild list each time
  const existing = panelEl.querySelector(".te-list");
  if (existing) existing.remove();

  const allTags = collectAllTags();

  if (allTags.length === 0) {
    const msg = document.createElement("p");
    msg.className = "te-empty";
    msg.textContent = "No tags in current agenda";
    panelEl.appendChild(msg);
    overlayEl.classList.add("is-open");
    panelEl.classList.add("is-open");
    return;
  }

  // Ensure every tag has a color assigned
  for (const tag of allTags) getTagColor(tag);

  const list = document.createElement("ul");
  list.className = "te-list";

  for (const tag of allTags) {
    const row = document.createElement("li");
    row.className = "te-row";

    const swatch = document.createElement("input");
    swatch.type = "color";
    swatch.className = "te-swatch-hidden";
    swatch.value = getTagColor(tag);

    const label = document.createElement("span");
    label.className = "te-label";
    label.textContent = tag;
    label.style.background = swatch.value;

    const resetBtn = document.createElement("button");
    resetBtn.className = "te-reset";
    resetBtn.textContent = "Reset";
    resetBtn.setAttribute("aria-label", `Reset ${tag} color`);

    label.addEventListener("click", () => swatch.click());

    swatch.addEventListener("input", () => {
      setTagColor(tag, swatch.value);
      label.style.background = swatch.value;
    });

    resetBtn.addEventListener("click", () => {
      resetTagColor(tag);
      const fresh = getTagColor(tag);
      swatch.value = fresh;
      label.style.background = fresh;
    });

    const spacer = document.createElement("span");
    spacer.className = "te-spacer";

    row.append(swatch, label, spacer, resetBtn);
    list.appendChild(row);
  }

  panelEl.appendChild(list);
  overlayEl.classList.add("is-open");
  panelEl.classList.add("is-open");
}

function closeTagEditor(): void {
  if (!panelEl || !overlayEl) return;
  overlayEl.classList.remove("is-open");
  panelEl.classList.remove("is-open");

  // Clean up list / empty message so it's rebuilt fresh next open
  const list = panelEl.querySelector(".te-list");
  if (list) list.remove();
  const msg = panelEl.querySelector(".te-empty");
  if (msg) msg.remove();

  render();
}

// ── Add-item panel ─────────────────────────────────────────────────

let addPanelEl: HTMLElement | null = null;
let addOverlayEl: HTMLElement | null = null;
let addPanelTitleEl: HTMLElement | null = null;
let editingLine: number | null = null;
let editingPriority: "A" | "B" | "C" | null = null;
let editingSchedRepeater: string | null = null;
let editingDeadRepeater: string | null = null;

interface AddPanelRefs {
  typeGroup: HTMLElement;
  titleInput: HTMLInputElement;
  whenInput: HTMLInputElement;
  schedInput: HTMLInputElement;
  deadInput: HTMLInputElement;
  tagsInput: HTMLInputElement;
  repeatSelect: HTMLSelectElement;
  syncVisibility: () => void;
}
let addPanelRefs: AddPanelRefs | null = null;

const DAY_ABBREVS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildAddPanel(): void {
  addOverlayEl = document.createElement("div");
  addOverlayEl.className = "add-overlay";
  addOverlayEl.addEventListener("click", closeAddPanel);

  addPanelEl = document.createElement("aside");
  addPanelEl.className = "add-panel";

  // Header
  const header = document.createElement("div");
  header.className = "te-header";

  const title = document.createElement("span");
  title.textContent = "Add item";
  addPanelTitleEl = title;

  const closeBtn = document.createElement("button");
  closeBtn.className = "te-close";
  closeBtn.textContent = "\u00D7";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", closeAddPanel);

  header.append(title, closeBtn);
  addPanelEl.appendChild(header);

  // Form
  const form = document.createElement("div");
  form.className = "add-form";

  // Type toggle
  const typeGroup = makeRadioGroup("Type", "add-type", [
    { value: "todo", label: "TODO", checked: true },
    { value: "event", label: "Event" },
  ]);
  form.appendChild(typeGroup.container);

  // Title
  const titleInput = makeTextInput("Title", "add-title");
  form.appendChild(titleInput.container);

  // Event: when
  const whenInput = makeDateTimeInput("When", "add-when");
  form.appendChild(whenInput.container);

  // TODO: scheduled / deadline (combined date+time)
  const schedInput = makeDateTimeInput("Scheduled", "add-sched");
  form.appendChild(schedInput.container);

  const deadInput = makeDateTimeInput("Deadline", "add-dead");
  form.appendChild(deadInput.container);

  // Repeat (event only)
  const repeatSelect = makeSelect("Repeat", "add-repeat", [
    { value: "", label: "None" },
    { value: "+1d", label: "Daily" },
    { value: "+1w", label: "Weekly" },
    { value: "+2w", label: "Every 2 weeks" },
    { value: "+1m", label: "Monthly" },
    { value: "+1y", label: "Yearly" },
  ]);
  form.appendChild(repeatSelect.container);

  // Tags
  const tagsInput = makeTextInput("Tags", "add-tags");
  tagsInput.input.placeholder = "comma-separated";
  form.appendChild(tagsInput.container);

  // Show/hide fields based on type
  const typeRadios = typeGroup.container.querySelectorAll<HTMLInputElement>("input[name='add-type']");
  const syncVisibility = (): void => {
    const isTodo = (typeGroup.container.querySelector<HTMLInputElement>("input[name='add-type']:checked"))?.value === "todo";
    whenInput.container.style.display = isTodo ? "none" : "";
    repeatSelect.container.style.display = isTodo ? "none" : "";
    schedInput.container.style.display = isTodo ? "" : "none";
    deadInput.container.style.display = isTodo ? "" : "none";
  };
  typeRadios.forEach(r => r.addEventListener("change", syncVisibility));
  syncVisibility();

  // Save button
  const saveBtn = document.createElement("button");
  saveBtn.className = "add-save-btn";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    const type = (typeGroup.container.querySelector<HTMLInputElement>("input[name='add-type']:checked"))?.value ?? "todo";
    const heading = titleInput.input.value.trim();
    if (!heading) { titleInput.input.focus(); return; }
    const tagsVal = tagsInput.input.value.trim();

    const readDT = (inp: HTMLInputElement): { date: string; time: string } | null => {
      const raw = inp.value.trim();
      if (!raw) return { date: "", time: "" };
      const parsed = parseDateTime(raw);
      if (!parsed) { inp.focus(); return null; }
      return parsed;
    };

    let orgText: string;
    if (type === "event") {
      const dt = readDT(whenInput.input); if (dt === null) return;
      if (!dt.date) { whenInput.input.focus(); return; }
      const repeaterVal = repeatSelect.select.value || null;
      orgText = buildOrgText({
        type: "event", heading, tags: tagsVal,
        priority: editingPriority,
        date: dt.date, time: dt.time, repeater: repeaterVal,
      });
    } else {
      const s = readDT(schedInput.input); if (s === null) return;
      const d = readDT(deadInput.input); if (d === null) return;
      orgText = buildOrgText({
        type: "todo", heading, tags: tagsVal,
        priority: editingPriority,
        schedDate: s.date, schedTime: s.time, schedRepeater: editingSchedRepeater,
        deadDate: d.date, deadTime: d.time, deadRepeater: editingDeadRepeater,
      });
    }

    if (editingLine !== null) {
      replaceOrgBlock(editingLine, orgText);
    } else {
      appendOrgText(orgText);
    }
    closeAddPanel();
  });
  form.appendChild(saveBtn);

  addPanelEl.appendChild(form);
  document.body.append(addOverlayEl, addPanelEl);

  addPanelRefs = {
    typeGroup: typeGroup.container,
    titleInput: titleInput.input,
    whenInput: whenInput.input,
    schedInput: schedInput.input,
    deadInput: deadInput.input,
    tagsInput: tagsInput.input,
    repeatSelect: repeatSelect.select,
    syncVisibility,
  };
}

function makeSelect(label: string, id: string, options: { value: string; label: string }[]): { container: HTMLElement; select: HTMLSelectElement } {
  const container = document.createElement("div");
  container.className = "add-field";

  const lbl = document.createElement("label");
  lbl.className = "add-label";
  lbl.htmlFor = id;
  lbl.textContent = label;

  const select = document.createElement("select");
  select.id = id;
  select.className = "add-input";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    select.appendChild(o);
  }

  container.append(lbl, select);
  return { container, select };
}

function makeRadioGroup(label: string, name: string, options: { value: string; label: string; checked?: boolean }[]): { container: HTMLElement } {
  const container = document.createElement("div");
  container.className = "add-field";

  const lbl = document.createElement("label");
  lbl.className = "add-label";
  lbl.textContent = label;
  container.appendChild(lbl);

  const group = document.createElement("div");
  group.className = "add-radio-group";

  for (const opt of options) {
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = name;
    radio.value = opt.value;
    radio.id = `${name}-${opt.value}`;
    if (opt.checked) radio.checked = true;

    const radioLabel = document.createElement("label");
    radioLabel.htmlFor = radio.id;
    radioLabel.textContent = opt.label;
    radioLabel.className = "add-radio-label";

    group.append(radio, radioLabel);
  }

  container.appendChild(group);
  return { container };
}

function makeTextInput(label: string, id: string): { container: HTMLElement; input: HTMLInputElement } {
  const container = document.createElement("div");
  container.className = "add-field";

  const lbl = document.createElement("label");
  lbl.className = "add-label";
  lbl.htmlFor = id;
  lbl.textContent = label;

  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.className = "add-input";

  container.append(lbl, input);
  return { container, input };
}

/** Expand shorthand date input to YYYY-MM-DD. Accepts DD, DD/MM, or DD/MM/YYYY. */
function expandDate(raw: string): string {
  if (!raw) return "";
  const now = new Date();
  const full = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (full) return `${full[3]}-${full[2].padStart(2, "0")}-${full[1].padStart(2, "0")}`;
  const dm = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (dm) return `${now.getFullYear()}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  const d = raw.match(/^(\d{1,2})$/);
  if (d) return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${d[1].padStart(2, "0")}`;
  return "";
}

function makeDateTimeInput(label: string, id: string): { container: HTMLElement; input: HTMLInputElement } {
  const container = document.createElement("div");
  container.className = "add-field";

  const lbl = document.createElement("label");
  lbl.className = "add-label";
  lbl.htmlFor = id;
  lbl.textContent = label;

  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.className = "add-input";
  input.placeholder = "DD[/MM[/YYYY]] [HH:MM[-HH:MM]] | HH:MM";

  container.append(lbl, input);
  return { container, input };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(-([01]\d|2[0-3]):[0-5]\d)?$/;

/**
 * Parse a combined date/time field. Accepts "<date>" or "<date> <time>".
 * Date forms: DD, DD/MM, DD/MM/YYYY. Time forms: HH:MM or HH:MM-HH:MM.
 * Returns null on invalid input.
 */
function parseDateTime(raw: string): { date: string; time: string } | null {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { date: "", time: "" };

  let time = "";
  let dateRaw: string;
  const last = parts[parts.length - 1];
  if (TIME_RE.test(last)) {
    time = last;
    dateRaw = parts.slice(0, -1).join(" ");
  } else {
    dateRaw = parts.join(" ");
  }

  if (!dateRaw) {
    if (!time) return null;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return { date: today, time };
  }
  const date = expandDate(dateRaw);
  if (!date) return null;
  return { date, time };
}

interface BuildOrgOpts {
  type: "todo" | "event";
  heading: string;
  tags: string;
  priority?: "A" | "B" | "C" | null;
  // event
  date?: string;
  time?: string;
  repeater?: string | null;
  // todo
  schedDate?: string;
  schedTime?: string;
  schedRepeater?: string | null;
  deadDate?: string;
  deadTime?: string;
  deadRepeater?: string | null;
}

function buildOrgText(opts: BuildOrgOpts): string {
  let tagStr = "";
  if (opts.tags) {
    const tagList = opts.tags.split(",").map(t => t.trim()).filter(Boolean);
    if (tagList.length > 0) tagStr = " :" + tagList.join(":") + ":";
  }

  const todoPrefix = opts.type === "todo" ? "TODO " : "";
  const priorityPrefix = opts.priority ? `[#${opts.priority}] ` : "";
  const headingLine = `* ${todoPrefix}${priorityPrefix}${opts.heading}${tagStr}`;

  const makeTs = (date: string, time: string | undefined, repeater: string | null | undefined): string => {
    const d = new Date(date + "T00:00:00");
    const dayAbbrev = DAY_ABBREVS[d.getDay()];
    const timeStr = time ? ` ${time}` : "";
    const repStr = repeater ? ` ${repeater}` : "";
    return `<${date} ${dayAbbrev}${timeStr}${repStr}>`;
  };

  if (opts.type === "event") {
    if (!opts.date) return headingLine;
    return `${headingLine}\n  ${makeTs(opts.date, opts.time, opts.repeater)}`;
  }

  // TODO: up to one SCHEDULED and one DEADLINE
  const lines: string[] = [headingLine];
  if (opts.schedDate) lines.push(`  SCHEDULED: ${makeTs(opts.schedDate, opts.schedTime, opts.schedRepeater)}`);
  if (opts.deadDate) lines.push(`  DEADLINE: ${makeTs(opts.deadDate, opts.deadTime, opts.deadRepeater)}`);
  return lines.join("\n");
}

/**
 * Replace the block for an entry at `sourceLine` with `newText`, preserving
 * any body text (non-planning, non-bare-timestamp lines) that followed the
 * original heading. The block extends from the heading line up to (but not
 * including) the next heading or EOF.
 */
function replaceOrgBlock(sourceLine: number, newText: string): void {
  const existing = currentSource;
  const lines = existing.split("\n");
  const startIdx = sourceLine - 1;
  if (startIdx < 0 || startIdx >= lines.length) return;

  // Find end of block: next heading or EOF
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^\*+\s/.test(lines[i])) { endIdx = i; break; }
  }

  // Preserve body lines that aren't planning or bare timestamps — those are
  // the structural lines buildOrgText regenerates.
  const structuralRe = /^\s*(?:(?:SCHEDULED|DEADLINE):\s*)?<\d{4}-\d{2}-\d{2}/;
  const preserved: string[] = [];
  for (let i = startIdx + 1; i < endIdx; i++) {
    if (!structuralRe.test(lines[i])) preserved.push(lines[i]);
  }

  const newBlockLines = newText.split("\n");
  const updated = [
    ...lines.slice(0, startIdx),
    ...newBlockLines,
    ...preserved,
    ...lines.slice(endIdx),
  ].join("\n");

  void persistSource(updated);
}

/**
 * Flip TODO↔DONE on the heading line of the entry at `sourceLine`. Edits
 * only the heading, leaving planning lines and body untouched.
 */
async function toggleDone(sourceLine: number): Promise<void> {
  const lines = currentSource.split("\n");
  const idx = sourceLine - 1;
  if (idx < 0 || idx >= lines.length) return;
  const m = lines[idx].match(/^(\*+\s+)(TODO|DONE)(\b.*)?$/);
  if (!m) return;
  const next = m[2] === "TODO" ? "DONE" : "TODO";
  lines[idx] = `${m[1]}${next}${m[3] ?? ""}`;
  await persistSource(lines.join("\n"));
}

function appendOrgText(orgText: string): void {
  const updated = currentSource.trimEnd() + "\n" + orgText + "\n";
  void persistSource(updated);
}

function openAddPanel(): void {
  if (!addPanelEl || !addOverlayEl || !addPanelRefs) return;

  editingLine = null;
  editingPriority = null;
  editingSchedRepeater = null;
  editingDeadRepeater = null;
  if (addPanelTitleEl) addPanelTitleEl.textContent = "Add item";

  const refs = addPanelRefs;
  refs.titleInput.value = "";
  refs.whenInput.value = "";
  refs.schedInput.value = "";
  refs.deadInput.value = "";
  refs.tagsInput.value = "";
  refs.repeatSelect.value = "";
  const todoRadio = refs.typeGroup.querySelector<HTMLInputElement>("input[value='todo']");
  if (todoRadio) todoRadio.checked = true;
  refs.syncVisibility();

  addOverlayEl.classList.add("is-open");
  addPanelEl.classList.add("is-open");
  setTimeout(() => refs.titleInput.focus(), 250);
}

function tsToTimeDisplay(ts: { startTime: string | null; endTime: string | null }): string {
  if (!ts.startTime) return "";
  return ts.endTime ? `${ts.startTime}-${ts.endTime}` : ts.startTime;
}

function tsToDateTimeDisplay(ts: { date: string; startTime: string | null; endTime: string | null }): string {
  const d = isoToDisplayDate(ts.date);
  const t = tsToTimeDisplay(ts);
  return t ? `${d} ${t}` : d;
}

function openEditPanel(sourceLine: number): void {
  if (!addPanelEl || !addOverlayEl || !addPanelRefs) return;

  const entry = entries.find(e => e.sourceLineNumber === sourceLine);
  if (!entry) return;

  editingLine = sourceLine;
  editingPriority = entry.priority;
  if (addPanelTitleEl) addPanelTitleEl.textContent = "Edit item";

  const refs = addPanelRefs;

  const type = entry.todo ? "todo" : "event";
  const typeRadio = refs.typeGroup.querySelector<HTMLInputElement>(`input[value="${type}"]`);
  if (typeRadio) typeRadio.checked = true;

  refs.titleInput.value = entry.title;
  refs.tagsInput.value = entry.tags.join(", ");

  refs.whenInput.value = "";
  refs.schedInput.value = "";
  refs.deadInput.value = "";
  refs.repeatSelect.value = "";
  editingSchedRepeater = null;
  editingDeadRepeater = null;

  if (type === "event") {
    const ts = entry.timestamps[0] ?? null;
    if (ts) {
      refs.whenInput.value = tsToDateTimeDisplay(ts);
      refs.repeatSelect.value = ts.repeater ? `+${ts.repeater.value}${ts.repeater.unit}` : "";
    }
  } else {
    const sched = entry.planning.find(p => p.kind === "scheduled");
    const deadline = entry.planning.find(p => p.kind === "deadline");
    if (sched) {
      refs.schedInput.value = tsToDateTimeDisplay(sched.timestamp);
      editingSchedRepeater = sched.timestamp.repeater
        ? `+${sched.timestamp.repeater.value}${sched.timestamp.repeater.unit}` : null;
    }
    if (deadline) {
      refs.deadInput.value = tsToDateTimeDisplay(deadline.timestamp);
      editingDeadRepeater = deadline.timestamp.repeater
        ? `+${deadline.timestamp.repeater.value}${deadline.timestamp.repeater.unit}` : null;
    }
  }

  refs.syncVisibility();

  addOverlayEl.classList.add("is-open");
  addPanelEl.classList.add("is-open");
  setTimeout(() => refs.titleInput.focus(), 250);
}

function isoToDisplayDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function closeAddPanel(): void {
  if (!addPanelEl || !addOverlayEl) return;
  addOverlayEl.classList.remove("is-open");
  addPanelEl.classList.remove("is-open");
}

// ── Bootstrap ────────────────────────────────────────────────────────

async function init(): Promise<void> {
  buildTagEditorPanel();
  buildAddPanel();
  setupNavigation();
  startClockTicker();

  // If a local Mediant server is running, hydrate from the configured
  // Org file and skip the textarea input screen entirely.
  const isServer = await probeServer();
  if (isServer) {
    entries = parseOrg(currentSource);
    currentStart = todayMidnight();
    render();
    subscribeToServerChanges();
  } else {
    showInput();
  }
}

/**
 * Re-render once per minute so the now-line and "today" indication stay
 * current without requiring a page reload. Aligns to the next minute
 * boundary so updates land close to :00 seconds.
 */
function startClockTicker(): void {
  const tick = (): void => {
    if (agendaLoaded && document.visibilityState === "visible") render();
  };
  const msToNextMinute = 60_000 - (Date.now() % 60_000);
  setTimeout(() => {
    tick();
    setInterval(tick, 60_000);
  }, msToNextMinute);
  // Also refresh immediately when the tab becomes visible again.
  document.addEventListener("visibilitychange", () => {
    if (agendaLoaded && document.visibilityState === "visible") render();
  });
}

function showInput(): void {
  const container = document.getElementById("agenda")!;
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "input-screen";

  const title = document.createElement("h1");
  title.textContent = "Mediant";
  title.className = "input-title";

  const textarea = document.createElement("textarea");
  textarea.className = "input-textarea";
  textarea.placeholder = "Paste your Org-mode content here\u2026";
  textarea.spellcheck = false;
  textarea.value = localStorage.getItem("mediant-org-source") ?? "";

  const btn = document.createElement("button");
  btn.className = "input-load-btn";
  btn.textContent = "Load agenda";
  btn.addEventListener("click", () => loadFromTextarea(textarea.value));

  const themeBtn = document.createElement("button");
  themeBtn.className = "theme-toggle";
  themeBtn.setAttribute("aria-label", "Toggle dark mode");
  themeBtn.textContent = document.documentElement.dataset.theme === "dark" ? "\u2600" : "\u263E";
  themeBtn.addEventListener("click", () => {
    const isDark = document.documentElement.dataset.theme === "dark";
    if (isDark) {
      delete document.documentElement.dataset.theme;
      localStorage.setItem("theme", "light");
      themeBtn.textContent = "\u263E";
    } else {
      document.documentElement.dataset.theme = "dark";
      localStorage.setItem("theme", "dark");
      themeBtn.textContent = "\u2600";
    }
  });

  const ghLink = document.createElement("a");
  ghLink.className = "github-link";
  ghLink.href = "https://github.com/Lycomedes1814/Mediant";
  ghLink.target = "_blank";
  ghLink.rel = "noopener noreferrer";
  ghLink.setAttribute("aria-label", "View on GitHub");
  ghLink.innerHTML = `<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

  const headerRight = document.createElement("div");
  headerRight.className = "input-header-right";
  headerRight.append(ghLink, themeBtn);

  const header = document.createElement("div");
  header.className = "input-header";
  header.append(title, headerRight);

  wrapper.append(header, textarea, btn);
  container.appendChild(wrapper);
  textarea.focus();
}

function exceedsLimit(source: string): boolean {
  return new Blob([source]).size > MAX_INPUT_BYTES;
}

// ── Source persistence ─────────────────────────────────────────────

/**
 * Probe for a running Mediant server. In server mode, the UI reads/writes
 * the configured Org file via /api/source instead of localStorage, and
 * subscribes to /api/events for external file changes.
 */
async function probeServer(): Promise<boolean> {
  try {
    const r = await fetch("/api/source");
    if (!r.ok) return false;
    serverVersion = r.headers.get("X-Version");
    currentSource = await r.text();
    serverMode = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Write `updated` to the active backend (server PUT or localStorage),
 * then refresh entries and re-render. On a server version mismatch
 * (409), reload the file from disk — the on-disk copy wins.
 */
async function persistSource(updated: string): Promise<boolean> {
  if (exceedsLimit(updated)) {
    alert("Source exceeds the 4 MB limit.");
    return false;
  }

  if (serverMode) {
    try {
      const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8" };
      if (serverVersion) headers["If-Match"] = serverVersion;
      const r = await fetch("/api/source", { method: "PUT", headers, body: updated });
      if (r.status === 409) {
        alert("File was modified externally; reloading from disk.");
        await reloadFromServer();
        return false;
      }
      if (!r.ok) {
        alert(`Failed to save: ${r.status} ${r.statusText}`);
        return false;
      }
      serverVersion = r.headers.get("X-Version");
      currentSource = updated;
      entries = parseOrg(updated);
      render();
      return true;
    } catch (e) {
      alert(`Save failed: ${(e as Error).message}`);
      return false;
    }
  }

  localStorage.setItem("mediant-org-source", updated);
  currentSource = updated;
  entries = parseOrg(updated);
  render();
  return true;
}

async function reloadFromServer(): Promise<void> {
  try {
    const r = await fetch("/api/source");
    if (!r.ok) return;
    serverVersion = r.headers.get("X-Version");
    currentSource = await r.text();
    entries = parseOrg(currentSource);
    render();
  } catch {
    // swallow — next SSE event or user action will retry
  }
}

function subscribeToServerChanges(): void {
  const es = new EventSource("/api/events");
  es.onmessage = (ev) => {
    if (ev.data && ev.data !== serverVersion) {
      void reloadFromServer();
    }
  };
  // On transient disconnect EventSource auto-reconnects; nothing to do.
}

async function loadFromTextarea(source: string): Promise<void> {
  currentStart = todayMidnight();
  await persistSource(source);
}

// ── Render ───────────────────────────────────────────────────────────

function render(): void {
  const container = document.getElementById("agenda");
  if (!container) return;

  agendaLoaded = true;
  const today = new Date();
  const week = generateWeek(entries, currentStart);
  const deadlines = collectDeadlines(entries, today);
  const overdue = collectOverdueItems(entries, today);
  const someday = collectSomedayItems(entries);

  renderAgenda(container, week, deadlines, overdue, someday, today);
}

// ── Navigation ───────────────────────────────────────────────────────

function setupNavigation(): void {
  document.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (!action) return;

    if (action === "prev") {
      currentStart.setDate(currentStart.getDate() - 7);
      render();
    } else if (action === "next") {
      currentStart.setDate(currentStart.getDate() + 7);
      render();
    } else if (action === "today") {
      currentStart = todayMidnight();
      render();
    } else if (action === "tags") {
      openTagEditor();
    } else if (action === "add") {
      openAddPanel();
    } else if (action === "edit") {
      const line = Number(btn.dataset.line);
      if (line) openEditPanel(line);
    } else if (action === "toggle-done") {
      e.stopPropagation();
      const line = Number(btn.dataset.line);
      if (line) void toggleDone(line);
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function todayMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// ── Go ───────────────────────────────────────────────────────────────

if (localStorage.getItem("theme") === "dark") {
  document.documentElement.dataset.theme = "dark";
}
void init();
