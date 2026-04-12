import { parseOrg } from "./org/parser.ts";
import { generateWeek, collectDeadlines, collectOverdueItems, collectSomedayItems } from "./agenda/generate.ts";
import { renderAgenda } from "./ui/render.ts";
import { getTagColor, setTagColor, resetTagColor } from "./ui/tagColors.ts";

// ── Constants ───────────────────────────────────────────────────────

const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MB

// ── State ────────────────────────────────────────────────────────────

let entries = parseOrg("");
let currentStart = todayMidnight();

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

interface AddPanelRefs {
  typeGroup: HTMLElement;
  titleInput: HTMLInputElement;
  dateInput: HTMLInputElement;
  timeInput: HTMLInputElement;
  planGroup: HTMLElement;
  tagsInput: HTMLInputElement;
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

  // Date
  const dateInput = makeDateInput("Date", "add-date");
  form.appendChild(dateInput.container);

  // Time
  const timeInput = makeTimeInput("Time", "add-time");
  form.appendChild(timeInput.container);

  // Planning (TODO only)
  const planGroup = makeRadioGroup("Planning", "add-plan", [
    { value: "scheduled", label: "Scheduled", checked: true },
    { value: "deadline", label: "Deadline" },
    { value: "none", label: "None" },
  ]);
  form.appendChild(planGroup.container);

  // Tags
  const tagsInput = makeTextInput("Tags", "add-tags");
  tagsInput.input.placeholder = "comma-separated";
  form.appendChild(tagsInput.container);

  // Show/hide planning row based on type
  const typeRadios = typeGroup.container.querySelectorAll<HTMLInputElement>("input[name='add-type']");
  function syncPlanningVisibility(): void {
    const isTodo = (typeGroup.container.querySelector<HTMLInputElement>("input[name='add-type']:checked"))?.value === "todo";
    planGroup.container.style.display = isTodo ? "" : "none";
  }
  typeRadios.forEach(r => r.addEventListener("change", syncPlanningVisibility));
  syncPlanningVisibility();

  // Save button
  const saveBtn = document.createElement("button");
  saveBtn.className = "add-save-btn";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    const type = (typeGroup.container.querySelector<HTMLInputElement>("input[name='add-type']:checked"))?.value ?? "todo";
    const heading = titleInput.input.value.trim();
    if (!heading) { titleInput.input.focus(); return; }
    const dateVal = expandDate(dateInput.input.value.trim());
    if (dateInput.input.value.trim() && !dateVal) { dateInput.input.focus(); return; }
    const timeRaw = timeInput.input.value.trim();
    const timeVal = /^([01]\d|2[0-3]):[0-5]\d$/.test(timeRaw) ? timeRaw : "";
    if (timeRaw && !timeVal) { timeInput.input.focus(); return; }
    const planVal = (planGroup.container.querySelector<HTMLInputElement>("input[name='add-plan']:checked"))?.value ?? "scheduled";
    const tagsVal = tagsInput.input.value.trim();

    const orgText = buildOrgText(type, heading, dateVal, timeVal, planVal, tagsVal);
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
    dateInput: dateInput.input,
    timeInput: timeInput.input,
    planGroup: planGroup.container,
    tagsInput: tagsInput.input,
  };
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

function makeDateInput(label: string, id: string): { container: HTMLElement; input: HTMLInputElement } {
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
  input.placeholder = "DD or DD/MM or DD/MM/YYYY";
  input.maxLength = 10;
  input.addEventListener("input", () => {
    const v = input.value.replace(/[^\d]/g, "");
    if (v.length >= 5) {
      input.value = v.slice(0, 2) + "/" + v.slice(2, 4) + "/" + v.slice(4, 8);
    } else if (v.length >= 3) {
      input.value = v.slice(0, 2) + "/" + v.slice(2, 4);
    }
  });

  container.append(lbl, input);
  return { container, input };
}

function makeTimeInput(label: string, id: string): { container: HTMLElement; input: HTMLInputElement } {
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
  input.placeholder = "HH:MM";
  input.pattern = "^([01]\\d|2[0-3]):[0-5]\\d$";
  input.maxLength = 5;
  input.addEventListener("input", () => {
    const v = input.value.replace(/[^\d]/g, "");
    if (v.length >= 3) {
      input.value = v.slice(0, 2) + ":" + v.slice(2, 4);
    }
  });

  container.append(lbl, input);
  return { container, input };
}

function buildOrgText(type: string, heading: string, date: string, time: string, plan: string, tags: string): string {
  // Build tag string
  let tagStr = "";
  if (tags) {
    const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);
    if (tagList.length > 0) tagStr = " :" + tagList.join(":") + ":";
  }

  // Build heading line
  const todoPrefix = type === "todo" ? "TODO " : "";
  const headingLine = `* ${todoPrefix}${heading}${tagStr}`;

  // Build timestamp
  if (!date) return headingLine; // no date → someday item

  const d = new Date(date + "T00:00:00");
  const dayAbbrev = DAY_ABBREVS[d.getDay()];
  const timeStr = time ? ` ${time}` : "";
  const timestamp = `<${date} ${dayAbbrev}${timeStr}>`;

  if (type === "todo" && plan !== "none") {
    const keyword = plan === "deadline" ? "DEADLINE" : "SCHEDULED";
    return `${headingLine}\n  ${keyword}: ${timestamp}`;
  }

  // Event or TODO with plan=none: timestamp as body
  return `${headingLine}\n  ${timestamp}`;
}

/**
 * Replace the block for an entry at `sourceLine` with `newText`, preserving
 * any body text (non-planning, non-bare-timestamp lines) that followed the
 * original heading. The block extends from the heading line up to (but not
 * including) the next heading or EOF.
 */
function replaceOrgBlock(sourceLine: number, newText: string): void {
  const existing = localStorage.getItem("mediant-org-source") ?? "";
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

  if (exceedsLimit(updated)) {
    alert("Edit would exceed the 4 MB limit.");
    return;
  }
  localStorage.setItem("mediant-org-source", updated);
  entries = parseOrg(updated);
  render();
}

function appendOrgText(orgText: string): void {
  const existing = localStorage.getItem("mediant-org-source") ?? "";
  const updated = existing.trimEnd() + "\n" + orgText + "\n";
  if (exceedsLimit(updated)) {
    alert("Adding this item would exceed the 4 MB limit.");
    return;
  }
  localStorage.setItem("mediant-org-source", updated);
  entries = parseOrg(updated);
  render();
}

function openAddPanel(): void {
  if (!addPanelEl || !addOverlayEl) return;

  editingLine = null;
  if (addPanelTitleEl) addPanelTitleEl.textContent = "Add item";

  // Reset form fields
  const form = addPanelEl.querySelector(".add-form");
  if (form) {
    form.querySelectorAll<HTMLInputElement>("input[type='text']").forEach(i => { i.value = ""; });
    const todoRadio = form.querySelector<HTMLInputElement>("input[value='todo']");
    if (todoRadio) todoRadio.checked = true;
    const schedRadio = form.querySelector<HTMLInputElement>("input[value='scheduled']");
    if (schedRadio) schedRadio.checked = true;
    // Trigger planning visibility sync
    const planField = form.querySelectorAll<HTMLElement>(".add-field")[4];
    if (planField) planField.style.display = "";
  }

  addOverlayEl.classList.add("is-open");
  addPanelEl.classList.add("is-open");

  // Focus title input
  const titleInput = addPanelEl.querySelector<HTMLInputElement>("#add-title");
  if (titleInput) setTimeout(() => titleInput.focus(), 250);
}

function openEditPanel(sourceLine: number): void {
  if (!addPanelEl || !addOverlayEl || !addPanelRefs) return;

  const entry = entries.find(e => e.sourceLineNumber === sourceLine);
  if (!entry) return;

  editingLine = sourceLine;
  if (addPanelTitleEl) addPanelTitleEl.textContent = "Edit item";

  const refs = addPanelRefs;

  // Type
  const type = entry.todo ? "todo" : "event";
  const typeRadio = refs.typeGroup.querySelector<HTMLInputElement>(`input[value="${type}"]`);
  if (typeRadio) typeRadio.checked = true;

  // Title & tags
  refs.titleInput.value = entry.title;
  refs.tagsInput.value = entry.tags.join(", ");

  // Date / time / plan — prefer SCHEDULED, then DEADLINE, then first body timestamp
  const sched = entry.planning.find(p => p.kind === "scheduled");
  const deadline = entry.planning.find(p => p.kind === "deadline");
  const ts = sched?.timestamp ?? deadline?.timestamp ?? entry.timestamps[0] ?? null;

  refs.dateInput.value = ts ? isoToDisplayDate(ts.date) : "";
  refs.timeInput.value = ts?.startTime ?? "";

  const plan = sched ? "scheduled" : deadline ? "deadline" : "none";
  const planRadio = refs.planGroup.querySelector<HTMLInputElement>(`input[value="${plan}"]`);
  if (planRadio) planRadio.checked = true;

  refs.planGroup.style.display = type === "todo" ? "" : "none";

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

function init(): void {
  buildTagEditorPanel();
  buildAddPanel();
  setupNavigation();
  showInput();
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

function loadFromTextarea(source: string): void {
  if (exceedsLimit(source)) {
    alert("Input exceeds the 4 MB limit. Please use a smaller file.");
    return;
  }
  localStorage.setItem("mediant-org-source", source);
  entries = parseOrg(source);
  currentStart = todayMidnight();
  render();
}

// ── Render ───────────────────────────────────────────────────────────

function render(): void {
  const container = document.getElementById("agenda");
  if (!container) return;

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
init();
