import { parseOrg } from "./org/parser.ts";
import { upsertProperty, removeProperty } from "./org/drawer.ts";
import type { OrgEntry, RecurrenceException, RecurrenceOverride } from "./org/model.ts";
import {
  appendOrgTextToSource,
  deleteOrgBlockInSource,
  replaceOrgBlockInSource,
  toggleDoneInSource,
} from "./org/sourceEdit.ts";
import { generateWeek, collectDeadlines, collectOverdueItems, collectSomedayItems } from "./agenda/generate.ts";
import { renderAgenda, createThemeToggle } from "./ui/render.ts";
import { getTagColor } from "./ui/tagColors.ts";
import { scheduleNotifications } from "./ui/notifications.ts";

// ── Constants ───────────────────────────────────────────────────────

const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MB

// ── State ────────────────────────────────────────────────────────────

let entries = parseOrg("");
let currentStart = todayMidnight();
let currentSource = localStorage.getItem("mediant-org-source") ?? "";
let serverMode = false;
let serverVersion: string | null = null;
let agendaLoaded = false;

/** Collect every unique tag from the current parsed entries. */
function collectAllTags(): string[] {
  const tags = new Set<string>();
  for (const entry of entries) {
    for (const tag of entry.tags) tags.add(tag);
  }
  return [...tags].sort();
}

// ── Add-item panel ─────────────────────────────────────────────────

let addPanelEl: HTMLElement | null = null;
let addOverlayEl: HTMLElement | null = null;
let addPanelTitleEl: HTMLElement | null = null;
let addPanelSaveBtnEl: HTMLButtonElement | null = null;
let editingLine: number | null = null;
let editingBaseDate: string | null = null;
let editingLevel: number = 1;
let editingPriority: "A" | "B" | "C" | null = null;
let editingTodoState: "TODO" | "DONE" = "TODO";
let editingSchedRepeater: string | null = null;
let editingDeadRepeater: string | null = null;
let editingProgress: { done: number; total: number } | null = null;
let editingCheckboxItems: { text: string; checked: boolean }[] = [];

interface TagPicker {
  container: HTMLElement;
  getTags: () => string[];
  setTags: (tags: string[]) => void;
}

interface AddPanelRefs {
  typeGroup: HTMLElement;
  priorityGroup: HTMLElement;
  titleInput: HTMLInputElement;
  whenInput: HTMLInputElement;
  schedInput: HTMLInputElement;
  deadInput: HTMLInputElement;
  tagPicker: TagPicker;
  repeatSelect: HTMLSelectElement;
  checkboxSection: HTMLElement;
  syncVisibility: () => void;
  occurrenceSection: HTMLElement;
  occurrenceMeta: HTMLElement;
  occurrenceState: HTMLElement;
  skipCheckboxRow: HTMLElement;
  skipCheckbox: HTMLInputElement;
  endSeriesCheckboxRow: HTMLElement;
  endSeriesCheckbox: HTMLInputElement;
  shiftInput: HTMLInputElement;
  rescheduleInput: HTMLInputElement;
  noteTextarea: HTMLTextAreaElement;
  clearOverrideBtn: HTMLButtonElement;
  clearNoteBtn: HTMLButtonElement;
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

  // Occurrence section (per-occurrence exceptions on a repeating entry)
  const occurrenceSection = document.createElement("div");
  occurrenceSection.className = "occurrence-section";
  form.appendChild(occurrenceSection);

  // Type toggle
  const typeGroup = makeRadioGroup("Type", "add-type", [
    { value: "todo", label: "TODO", checked: true },
    { value: "event", label: "Event" },
  ]);
  form.appendChild(typeGroup.container);

  // Priority
  const priorityGroup = makeRadioGroup("Priority", "add-priority", [
    { value: "A", label: "#A" },
    { value: "B", label: "#B" },
    { value: "C", label: "#C" },
    { value: "", label: "None", checked: true },
  ]);
  form.appendChild(priorityGroup.container);

  // Wire priority radios to editingPriority
  const priorityRadios = priorityGroup.container.querySelectorAll<HTMLInputElement>("input[name='add-priority']");
  priorityRadios.forEach(r => r.addEventListener("change", () => {
    editingPriority = (r.value === "A" || r.value === "B" || r.value === "C") ? r.value : null;
  }));

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
  const tagPicker = makeTagPicker("Tags", "add-tags");
  form.appendChild(tagPicker.container);

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

  // Checkbox section
  const checkboxSection = document.createElement("div");
  checkboxSection.className = "add-field edit-checkboxes";
  form.appendChild(checkboxSection);

  const occurrenceMeta = document.createElement("div");
  occurrenceMeta.className = "occurrence-meta";
  occurrenceSection.appendChild(occurrenceMeta);

  const occurrenceState = document.createElement("div");
  occurrenceState.className = "occurrence-state";
  occurrenceSection.appendChild(occurrenceState);

  const occActions = document.createElement("div");
  occActions.className = "occurrence-actions";

  const skipCheckboxRow = document.createElement("label");
  skipCheckboxRow.className = "occurrence-toggle-row";
  const skipCheckbox = document.createElement("input");
  skipCheckbox.type = "checkbox";
  skipCheckbox.className = "occurrence-toggle-checkbox";
  const skipCheckboxText = document.createElement("span");
  skipCheckboxText.className = "occurrence-toggle-label";
  skipCheckboxText.textContent = "Skip this occurrence";
  skipCheckbox.addEventListener("change", () => void toggleOccurrenceSkipped());
  skipCheckboxRow.append(skipCheckbox, skipCheckboxText);

  const endSeriesCheckboxRow = document.createElement("label");
  endSeriesCheckboxRow.className = "occurrence-toggle-row";
  const endSeriesCheckbox = document.createElement("input");
  endSeriesCheckbox.type = "checkbox";
  endSeriesCheckbox.className = "occurrence-toggle-checkbox";
  const endSeriesCheckboxText = document.createElement("span");
  endSeriesCheckboxText.className = "occurrence-toggle-label";
  endSeriesCheckboxText.textContent = "This occurrence is the last";
  endSeriesCheckbox.addEventListener("change", () => void toggleOccurrenceIsLast());
  endSeriesCheckboxRow.append(endSeriesCheckbox, endSeriesCheckboxText);

  const shiftRow = document.createElement("div");
  shiftRow.className = "occurrence-row";
  const shiftInput = document.createElement("input");
  shiftInput.type = "text";
  shiftInput.className = "add-input occurrence-input";
  shiftInput.placeholder = "+45m / -1h / +1d";
  const shiftBtn = document.createElement("button");
  shiftBtn.type = "button";
  shiftBtn.className = "occurrence-btn";
  shiftBtn.textContent = "Shift";
  shiftBtn.addEventListener("click", () => {
    const raw = shiftInput.value.trim();
    if (!/^[+-]\d+[mhd]$/.test(raw)) { shiftInput.focus(); return; }
    applyOverride(`shift ${raw}`);
  });
  shiftRow.append(shiftInput, shiftBtn);

  const rescRow = document.createElement("div");
  rescRow.className = "occurrence-row";
  const rescheduleInput = document.createElement("input");
  rescheduleInput.type = "text";
  rescheduleInput.className = "add-input occurrence-input";
  rescheduleInput.placeholder = "DD/MM/YYYY | +N | mon-sun [HH:MM[-HH:MM]]";
  const rescBtn = document.createElement("button");
  rescBtn.type = "button";
  rescBtn.className = "occurrence-btn";
  rescBtn.textContent = "Move";
  rescBtn.addEventListener("click", () => {
    const parsed = parseDateTime(rescheduleInput.value);
    if (!parsed || !parsed.date) { rescheduleInput.focus(); return; }
    const timePart = parsed.time ? ` ${parsed.time}` : "";
    applyOverride(`reschedule ${parsed.date}${timePart}`);
  });
  rescRow.append(rescheduleInput, rescBtn);

  const clearOverrideBtn = document.createElement("button");
  clearOverrideBtn.type = "button";
  clearOverrideBtn.className = "occurrence-btn occurrence-btn-secondary";
  clearOverrideBtn.textContent = "Clear override";
  clearOverrideBtn.addEventListener("click", () => clearException("override"));

  occActions.append(skipCheckboxRow, endSeriesCheckboxRow, shiftRow, rescRow, clearOverrideBtn);
  occurrenceSection.appendChild(occActions);

  const noteLabel = document.createElement("label");
  noteLabel.className = "add-label";
  noteLabel.textContent = "Note for this occurrence";
  occurrenceSection.appendChild(noteLabel);

  const noteTextarea = document.createElement("textarea");
  noteTextarea.className = "occurrence-note";
  noteTextarea.rows = 2;
  noteTextarea.placeholder = "One-off note";
  occurrenceSection.appendChild(noteTextarea);

  const noteRow = document.createElement("div");
  noteRow.className = "occurrence-row occurrence-note-row";
  const saveNoteBtn = document.createElement("button");
  saveNoteBtn.type = "button";
  saveNoteBtn.className = "occurrence-btn";
  saveNoteBtn.textContent = "Save note";
  saveNoteBtn.addEventListener("click", () => {
    const text = noteTextarea.value.trim();
    if (text) applyNote(text); else clearException("note");
  });
  const clearNoteBtn = document.createElement("button");
  clearNoteBtn.type = "button";
  clearNoteBtn.className = "occurrence-btn occurrence-btn-secondary";
  clearNoteBtn.textContent = "Clear note";
  clearNoteBtn.addEventListener("click", () => clearException("note"));
  noteRow.append(saveNoteBtn, clearNoteBtn);
  occurrenceSection.appendChild(noteRow);

  // Save button
  const saveBtn = document.createElement("button");
  saveBtn.className = "add-save-btn";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    const type = (typeGroup.container.querySelector<HTMLInputElement>("input[name='add-type']:checked"))?.value ?? "todo";
    const heading = titleInput.input.value.trim();
    if (!heading) { titleInput.input.focus(); return; }
    const tagsVal = tagPicker.getTags().join(", ");

    const readDT = (inp: HTMLInputElement): { date: string; time: string } | null => {
      const raw = inp.value.trim();
      if (!raw) return { date: "", time: "" };
      const parsed = parseDateTime(raw);
      if (!parsed) { inp.focus(); return null; }
      return parsed;
    };

    // Strip empty checkbox items and sync progress before save
    const cbItems = editingCheckboxItems.filter(ci => ci.text.trim() !== "");
    if (cbItems.length > 0) {
      const done = cbItems.filter(ci => ci.checked).length;
      editingProgress = { done, total: cbItems.length };
    } else if (editingProgress && editingCheckboxItems.length === 0) {
      editingProgress = null;
    }

    let orgText: string;
    if (type === "event") {
      const dt = readDT(whenInput.input); if (dt === null) return;
      if (!dt.date) { whenInput.input.focus(); return; }
      const repeaterVal = repeatSelect.select.value || null;
      orgText = buildOrgText({
        type: "event", level: editingLevel, heading, tags: tagsVal,
        priority: editingPriority, progress: editingProgress,
        date: dt.date, time: dt.time, repeater: repeaterVal,
        checkboxItems: cbItems,
      });
    } else {
      const s = readDT(schedInput.input); if (s === null) return;
      const d = readDT(deadInput.input); if (d === null) return;
      orgText = buildOrgText({
        type: "todo", level: editingLevel, heading, tags: tagsVal,
        todoState: editingTodoState,
        priority: editingPriority, progress: editingProgress,
        schedDate: s.date, schedTime: s.time, schedRepeater: editingSchedRepeater,
        deadDate: d.date, deadTime: d.time, deadRepeater: editingDeadRepeater,
        checkboxItems: cbItems,
      });
    }

    if (editingLine !== null) {
      replaceOrgBlock(editingLine, orgText);
    } else {
      appendOrgText(orgText);
    }
    closeAddPanel();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "add-delete-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.type = "button";
  deleteBtn.addEventListener("click", () => {
    if (editingLine === null) return;
    if (!confirm("Delete this item?")) return;
    deleteOrgBlock(editingLine);
    closeAddPanel();
  });

  const btnRow = document.createElement("div");
  btnRow.className = "add-btn-row";
  btnRow.append(deleteBtn, saveBtn);
  form.appendChild(btnRow);
  addPanelSaveBtnEl = saveBtn;

  addPanelEl.appendChild(form);
  document.body.append(addOverlayEl, addPanelEl);

  addPanelRefs = {
    typeGroup: typeGroup.container,
    priorityGroup: priorityGroup.container,
    titleInput: titleInput.input,
    whenInput: whenInput.input,
    schedInput: schedInput.input,
    deadInput: deadInput.input,
    tagPicker,
    repeatSelect: repeatSelect.select,
    checkboxSection,
    syncVisibility,
    occurrenceSection,
    occurrenceMeta,
    occurrenceState,
    skipCheckboxRow,
    skipCheckbox,
    endSeriesCheckboxRow,
    endSeriesCheckbox,
    shiftInput,
    rescheduleInput,
    noteTextarea,
    clearOverrideBtn,
    clearNoteBtn,
  };
}

/**
 * Rebuild the checkbox editor UI inside the given container from
 * editingCheckboxItems. Each item gets a checkbox, editable text, and
 * a remove button. An "Add subtask" button at the bottom appends new items.
 */
function rebuildCheckboxUI(container: HTMLElement): void {
  container.innerHTML = "";

  const lbl = document.createElement("label");
  lbl.className = "add-label";
  lbl.textContent = "Checklist";
  container.appendChild(lbl);

  for (let ci = 0; ci < editingCheckboxItems.length; ci++) {
    const item = editingCheckboxItems[ci];
    const row = document.createElement("div");
    row.className = "edit-checkbox-row";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = item.checked;
    cb.addEventListener("change", () => {
      editingCheckboxItems[ci].checked = cb.checked;
      text.classList.toggle("edit-checkbox-done", cb.checked);
      syncProgress();
    });

    const text = document.createElement("input");
    text.type = "text";
    text.className = "edit-checkbox-text";
    text.value = item.text;
    text.placeholder = "Item text";
    if (item.checked) text.classList.add("edit-checkbox-done");
    text.addEventListener("input", () => {
      editingCheckboxItems[ci].text = text.value;
    });
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Add a new item below and focus it
        editingCheckboxItems.splice(ci + 1, 0, { text: "", checked: false });
        rebuildCheckboxUI(container);
        syncProgress();
        const rows = container.querySelectorAll<HTMLElement>(".edit-checkbox-text");
        (rows[ci + 1] as HTMLInputElement | undefined)?.focus();
      } else if (e.key === "Backspace" && text.value === "") {
        e.preventDefault();
        editingCheckboxItems.splice(ci, 1);
        rebuildCheckboxUI(container);
        syncProgress();
        // Focus the previous item, or the next if this was first
        const rows = container.querySelectorAll<HTMLElement>(".edit-checkbox-text");
        const target = ci > 0 ? rows[ci - 1] : rows[0];
        (target as HTMLInputElement | undefined)?.focus();
      }
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "edit-checkbox-remove";
    removeBtn.textContent = "\u00d7";
    removeBtn.title = "Remove item";
    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      editingCheckboxItems.splice(ci, 1);
      rebuildCheckboxUI(container);
      syncProgress();
    });

    row.append(cb, text, removeBtn);
    container.appendChild(row);
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "edit-checkbox-add";
  addBtn.textContent = "+ Add subtask";
  addBtn.addEventListener("click", () => {
    editingCheckboxItems.push({ text: "", checked: false });
    rebuildCheckboxUI(container);
    syncProgress();
    // Focus the new item's text
    const rows = container.querySelectorAll<HTMLElement>(".edit-checkbox-text");
    rows[rows.length - 1]?.focus();
  });
  container.appendChild(addBtn);

  function syncProgress(): void {
    if (editingCheckboxItems.length === 0) {
      editingProgress = null;
    } else {
      const done = editingCheckboxItems.filter(i => i.checked).length;
      editingProgress = { done, total: editingCheckboxItems.length };
    }
  }
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

function makeTagPicker(label: string, id: string): TagPicker {
  const container = document.createElement("div");
  container.className = "add-field";

  const lbl = document.createElement("label");
  lbl.className = "add-label";
  lbl.htmlFor = id;
  lbl.textContent = label;

  const wrapper = document.createElement("div");
  wrapper.className = "tag-picker";

  const pillsEl = document.createElement("div");
  pillsEl.className = "tag-picker-pills";

  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.className = "tag-picker-input";
  input.placeholder = "Type to add…";
  input.autocomplete = "off";

  const dropdown = document.createElement("div");
  dropdown.className = "tag-picker-dropdown";

  wrapper.append(pillsEl, input, dropdown);
  wrapper.addEventListener("click", () => input.focus());
  container.append(lbl, wrapper);

  let selected: string[] = [];

  function renderPills(): void {
    pillsEl.innerHTML = "";
    for (const tag of selected) {
      const pill = document.createElement("span");
      pill.className = "tag-picker-pill";
      pill.style.background = getTagColor(tag);

      const text = document.createElement("span");
      text.textContent = tag;

      const remove = document.createElement("button");
      remove.className = "tag-picker-pill-x";
      remove.textContent = "×";
      remove.type = "button";
      remove.addEventListener("click", () => {
        selected = selected.filter(t => t !== tag);
        renderPills();
        showDropdown();
      });

      pill.append(text, remove);
      pillsEl.appendChild(pill);
    }
  }

  function showDropdown(): void {
    const query = input.value.trim().toLowerCase();
    const allTags = collectAllTags().filter(t => !selected.includes(t));
    const matches = query
      ? allTags.filter(t => t.toLowerCase().includes(query))
      : allTags;

    dropdown.innerHTML = "";
    for (const tag of matches) {
      const opt = document.createElement("div");
      opt.className = "tag-picker-option";
      opt.textContent = tag;
      const swatch = document.createElement("span");
      swatch.className = "tag-picker-swatch";
      swatch.style.background = getTagColor(tag);
      opt.prepend(swatch);
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus on input
        selected.push(tag);
        input.value = "";
        renderPills();
        showDropdown();
      });
      dropdown.appendChild(opt);
    }

    // Show "add new" option if query doesn't match existing and isn't already selected
    if (query && !collectAllTags().some(t => t.toLowerCase() === query) && !selected.some(t => t.toLowerCase() === query)) {
      const addOpt = document.createElement("div");
      addOpt.className = "tag-picker-option tag-picker-option-new";
      addOpt.textContent = `Add "${input.value.trim()}"`;
      addOpt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selected.push(input.value.trim());
        input.value = "";
        renderPills();
        showDropdown();
      });
      dropdown.appendChild(addOpt);
    }

    dropdown.style.display = (matches.length > 0 || dropdown.children.length > 0) ? "block" : "none";
  }

  input.addEventListener("focus", showDropdown);
  input.addEventListener("input", showDropdown);
  input.addEventListener("blur", () => { dropdown.style.display = "none"; });

  // Backspace on empty input removes last pill
  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !input.value && selected.length > 0) {
      selected.pop();
      renderPills();
      showDropdown();
    }
    // Enter commits typed text as new tag
    if (e.key === "Enter") {
      e.preventDefault();
      const val = input.value.trim();
      if (val && !selected.some(t => t.toLowerCase() === val.toLowerCase())) {
        selected.push(val);
        input.value = "";
        renderPills();
        showDropdown();
      }
    }
  });

  return {
    container,
    getTags: () => [...selected],
    setTags: (tags: string[]) => {
      selected = [...tags];
      input.value = "";
      renderPills();
      dropdown.style.display = "none";
    },
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

/**
 * Expand shorthand date input to YYYY-MM-DD. Accepts:
 *   DD, DD/MM, DD/MM/YYYY — numeric forms (month/year default to today's)
 *   +N                    — N days from today (N >= 0)
 *   mon..sun              — next occurrence of that weekday, strictly forward
 */
function expandDate(raw: string): string {
  if (!raw) return "";
  const now = new Date();
  const fmt = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const full = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (full) return `${full[3]}-${full[2].padStart(2, "0")}-${full[1].padStart(2, "0")}`;
  const dm = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (dm) return `${now.getFullYear()}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  const d = raw.match(/^(\d{1,2})$/);
  if (d) return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${d[1].padStart(2, "0")}`;

  const plus = raw.match(/^\+(\d+)$/);
  if (plus) {
    const target = new Date(now);
    target.setDate(target.getDate() + Number(plus[1]));
    return fmt(target);
  }

  const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const idx = weekdays.indexOf(raw.toLowerCase());
  if (idx >= 0) {
    const delta = ((idx - now.getDay() + 7) % 7) || 7;
    const target = new Date(now);
    target.setDate(target.getDate() + delta);
    return fmt(target);
  }

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
  input.placeholder = "DD[/MM[/YYYY]] | +N | mon-sun [HH:MM[-HH:MM]]";

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
  level: number;
  heading: string;
  tags: string;
  todoState?: "TODO" | "DONE";
  priority?: "A" | "B" | "C" | null;
  progress?: { done: number; total: number } | null;
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
  checkboxItems?: { text: string; checked: boolean }[];
}

function buildOrgText(opts: BuildOrgOpts): string {
  let tagStr = "";
  if (opts.tags) {
    const tagList = opts.tags.split(",").map(t => t.trim()).filter(Boolean);
    if (tagList.length > 0) tagStr = " :" + tagList.join(":") + ":";
  }

  const todoPrefix = opts.type === "todo" ? `${opts.todoState ?? "TODO"} ` : "";
  const priorityPrefix = opts.priority ? `[#${opts.priority}] ` : "";
  const progressStr = opts.progress ? ` [${opts.progress.done}/${opts.progress.total}]` : "";
  const stars = "*".repeat(opts.level);
  const headingLine = `${stars} ${todoPrefix}${priorityPrefix}${opts.heading}${progressStr}${tagStr}`;

  const makeTs = (date: string, time: string | undefined, repeater: string | null | undefined): string => {
    const d = new Date(date + "T00:00:00");
    const dayAbbrev = DAY_ABBREVS[d.getDay()];
    const timeStr = time ? ` ${time}` : "";
    const repStr = repeater ? ` ${repeater}` : "";
    return `<${date} ${dayAbbrev}${timeStr}${repStr}>`;
  };

  const cbLines = (opts.checkboxItems ?? []).map(
    ci => `- [${ci.checked ? "X" : " "}] ${ci.text}`
  );

  if (opts.type === "event") {
    if (!opts.date) return [headingLine, ...cbLines].join("\n");
    return [headingLine, makeTs(opts.date, opts.time, opts.repeater), ...cbLines].join("\n");
  }

  // TODO: up to one SCHEDULED and one DEADLINE, emitted together on a single
  // planning line per Org convention (DEADLINE first, then SCHEDULED).
  const lines: string[] = [headingLine];
  const planningParts: string[] = [];
  if (opts.deadDate) planningParts.push(`DEADLINE: ${makeTs(opts.deadDate, opts.deadTime, opts.deadRepeater)}`);
  if (opts.schedDate) planningParts.push(`SCHEDULED: ${makeTs(opts.schedDate, opts.schedTime, opts.schedRepeater)}`);
  if (planningParts.length > 0) lines.push(planningParts.join(" "));
  lines.push(...cbLines);
  return lines.join("\n");
}

function replaceOrgBlock(sourceLine: number, newText: string): void {
  const updated = replaceOrgBlockInSource(currentSource, sourceLine, newText);
  void persistSource(updated);
}

async function toggleDone(sourceLine: number): Promise<void> {
  await persistSource(toggleDoneInSource(currentSource, sourceLine));
}

function deleteOrgBlock(sourceLine: number): void {
  void persistSource(deleteOrgBlockInSource(currentSource, sourceLine));
}

function appendOrgText(orgText: string): void {
  void persistSource(appendOrgTextToSource(currentSource, orgText));
}

function openAddPanel(): void {
  if (!addPanelEl || !addOverlayEl || !addPanelRefs) return;

  editingLine = null;
  editingBaseDate = null;
  editingLevel = 1;
  editingPriority = null;
  editingTodoState = "TODO";
  editingSchedRepeater = null;
  editingDeadRepeater = null;
  editingProgress = null;
  editingCheckboxItems = [];
  if (addPanelTitleEl) addPanelTitleEl.textContent = "Add item";
  if (addPanelSaveBtnEl) addPanelSaveBtnEl.textContent = "Save";
  addPanelEl.classList.remove("is-editing");
  addPanelEl.classList.remove("has-occurrence");

  const refs = addPanelRefs;
  refs.titleInput.value = "";
  refs.whenInput.value = "";
  refs.schedInput.value = "";
  refs.deadInput.value = "";
  refs.tagPicker.setTags([]);
  refs.repeatSelect.value = "";
  rebuildCheckboxUI(refs.checkboxSection);
  const todoRadio = refs.typeGroup.querySelector<HTMLInputElement>("input[value='todo']");
  if (todoRadio) todoRadio.checked = true;
  const noPriorityRadio = refs.priorityGroup.querySelector<HTMLInputElement>("input[value='']");
  if (noPriorityRadio) noPriorityRadio.checked = true;
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

function openEditPanel(sourceLine: number, baseDate: string | null = null): void {
  if (!addPanelEl || !addOverlayEl || !addPanelRefs) return;

  const entry = entries.find(e => e.sourceLineNumber === sourceLine);
  if (!entry) return;

  editingLine = sourceLine;
  editingBaseDate = baseDate;
  editingLevel = entry.level;
  editingPriority = entry.priority;
  editingTodoState = entry.todo === "DONE" ? "DONE" : "TODO";
  editingProgress = entry.progress;
  if (addPanelTitleEl) addPanelTitleEl.textContent = "Edit item";
  if (addPanelSaveBtnEl) addPanelSaveBtnEl.textContent = "Save";
  addPanelEl.classList.add("is-editing");
  addPanelEl.classList.toggle("has-occurrence", baseDate !== null && entryHasRepeater(entry));
  refreshOccurrenceSection();

  const refs = addPanelRefs;

  const type = entry.todo ? "todo" : "event";
  const typeRadio = refs.typeGroup.querySelector<HTMLInputElement>(`input[value="${type}"]`);
  if (typeRadio) typeRadio.checked = true;

  refs.titleInput.value = entry.title;
  refs.tagPicker.setTags([...entry.tags]);

  const prioVal = entry.priority ?? "";
  const prioRadio = refs.priorityGroup.querySelector<HTMLInputElement>(`input[value="${prioVal}"]`);
  if (prioRadio) prioRadio.checked = true;

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

  // Populate checkbox items
  editingCheckboxItems = entry.checkboxItems.map(ci => ({ text: ci.text, checked: ci.checked }));
  rebuildCheckboxUI(refs.checkboxSection);

  refs.syncVisibility();

  addOverlayEl.classList.add("is-open");
  addPanelEl.classList.add("is-open");
  setTimeout(() => refs.titleInput.focus(), 250);
}

function isoToDisplayDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

// ── Occurrence exceptions ───────────────────────────────────────────

function entryHasRepeater(entry: OrgEntry): boolean {
  for (const ts of entry.timestamps) if (ts.repeater) return true;
  for (const plan of entry.planning) if (plan.timestamp.repeater) return true;
  return false;
}

/**
 * Pick the repeating base timestamp used to describe the clicked
 * occurrence. SCHEDULED wins over DEADLINE wins over an active
 * timestamp, matching the agenda's typical primary row for an entry.
 */
function pickBaseTimestamp(entry: OrgEntry): OrgEntry["timestamps"][number] | OrgEntry["planning"][number]["timestamp"] | null {
  const sched = entry.planning.find(p => p.kind === "scheduled" && p.timestamp.repeater);
  if (sched) return sched.timestamp;
  const dead = entry.planning.find(p => p.kind === "deadline" && p.timestamp.repeater);
  if (dead) return dead.timestamp;
  const active = entry.timestamps.find(ts => ts.repeater);
  if (active) return active;
  return null;
}

function nextOccurrenceBoundary(
  ts: OrgEntry["timestamps"][number] | OrgEntry["planning"][number]["timestamp"] | null,
  baseDate: string,
): string | null {
  if (!ts?.repeater) return null;
  const [year, month, day] = baseDate.split("-").map(Number);
  const next = new Date(year, month - 1, day, 0, 0, 0, 0);
  switch (ts.repeater.unit) {
    case "d":
      next.setDate(next.getDate() + ts.repeater.value);
      break;
    case "w":
      next.setDate(next.getDate() + ts.repeater.value * 7);
      break;
    case "m":
      next.setMonth(next.getMonth() + ts.repeater.value);
      break;
    case "y":
      next.setFullYear(next.getFullYear() + ts.repeater.value);
      break;
  }
  return formatDateKey(next);
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatOccurrenceHeader(baseDate: string, base: { startTime: string | null; endTime: string | null } | null): string {
  const [y, m, d] = baseDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()];
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][dt.getMonth()];
  let out = `${dayName} ${dt.getDate()} ${monthName} ${y}`;
  if (base?.startTime) {
    out += base.endTime ? `, ${base.startTime}–${base.endTime}` : `, ${base.startTime}`;
  }
  return out;
}

function describeOverride(override: RecurrenceOverride): string {
  if (override.kind === "cancelled") return "Skipped";
  if (override.kind === "shift") {
    const m = override.offsetMinutes;
    const sign = m >= 0 ? "+" : "-";
    const abs = Math.abs(m);
    if (abs % 1440 === 0) return `Shifted ${sign}${abs / 1440}d`;
    if (abs % 60 === 0) return `Shifted ${sign}${abs / 60}h`;
    return `Shifted ${sign}${abs}m`;
  }
  // reschedule
  const [y, mo, d] = override.date.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()];
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][dt.getMonth()];
  let out = `Moved to ${dayName} ${dt.getDate()} ${monthName}`;
  if (override.startTime) {
    out += override.endTime ? `, ${override.startTime}–${override.endTime}` : `, ${override.startTime}`;
  }
  return out;
}

function refreshOccurrenceSection(): void {
  if (!addPanelRefs) return;
  const refs = addPanelRefs;
  if (editingLine === null || editingBaseDate === null) return;
  const entry = entries.find(e => e.sourceLineNumber === editingLine);
  if (!entry) return;

  const base = pickBaseTimestamp(entry);
  refs.occurrenceMeta.textContent = formatOccurrenceHeader(editingBaseDate, base);

  const ex: RecurrenceException | undefined = entry.exceptions.get(editingBaseDate);
  const override = ex?.override ?? null;
  const note = ex?.note ?? null;
  const isSkipped = override?.kind === "cancelled";

  refs.occurrenceState.textContent = override
    ? describeOverride(override)
    : "On schedule";
  refs.occurrenceState.classList.toggle("is-modified", override !== null);

  refs.skipCheckboxRow.style.display = "";
  refs.skipCheckbox.checked = isSkipped;
  const nextBaseKey = nextOccurrenceBoundary(base, editingBaseDate);
  const isSeriesLast = nextBaseKey !== null && entry.seriesUntil === nextBaseKey;
  refs.endSeriesCheckboxRow.style.display = nextBaseKey === null ? "none" : "";
  refs.endSeriesCheckbox.checked = isSeriesLast;
  refs.endSeriesCheckbox.disabled = nextBaseKey === null;
  refs.clearOverrideBtn.style.display = override ? "" : "none";
  refs.clearNoteBtn.style.display = note ? "" : "none";

  // Only rewrite textarea when it doesn't match the stored note, so
  // in-progress typing doesn't get clobbered by refresh calls.
  if (refs.noteTextarea.value !== (note ?? "")) {
    refs.noteTextarea.value = note ?? "";
  }
  refs.shiftInput.value = "";
  refs.rescheduleInput.value = "";
}

async function toggleOccurrenceSkipped(): Promise<void> {
  if (editingLine === null || editingBaseDate === null || !addPanelRefs) return;
  const entry = entries.find(e => e.sourceLineNumber === editingLine);
  if (!entry) return;
  const updated = addPanelRefs.skipCheckbox.checked
    ? upsertProperty(currentSource, entry, `EXCEPTION-${editingBaseDate}`, "cancelled")
    : entry.exceptions.get(editingBaseDate)?.override?.kind === "cancelled"
      ? removeProperty(currentSource, entry, `EXCEPTION-${editingBaseDate}`)
      : currentSource;
  const ok = await persistSource(updated);
  if (ok) refreshOccurrenceSection();
  else refreshOccurrenceSection();
}

async function toggleOccurrenceIsLast(): Promise<void> {
  if (editingLine === null || editingBaseDate === null) return;
  const entry = entries.find(e => e.sourceLineNumber === editingLine);
  if (!entry) return;
  const nextBaseKey = nextOccurrenceBoundary(pickBaseTimestamp(entry), editingBaseDate);
  if (nextBaseKey === null) return;
  const updated = addPanelRefs?.endSeriesCheckbox.checked
    ? upsertProperty(currentSource, entry, "SERIES-UNTIL", nextBaseKey)
    : entry.seriesUntil === nextBaseKey
      ? removeProperty(currentSource, entry, "SERIES-UNTIL")
      : currentSource;
  const ok = await persistSource(updated);
  if (ok) refreshOccurrenceSection();
  else if (addPanelRefs) refreshOccurrenceSection();
}

async function applyOverride(value: string): Promise<void> {
  if (editingLine === null || editingBaseDate === null) return;
  const entry = entries.find(e => e.sourceLineNumber === editingLine);
  if (!entry) return;
  const updated = upsertProperty(currentSource, entry, `EXCEPTION-${editingBaseDate}`, value);
  const ok = await persistSource(updated);
  if (ok) refreshOccurrenceSection();
}

async function applyNote(text: string): Promise<void> {
  if (editingLine === null || editingBaseDate === null) return;
  const entry = entries.find(e => e.sourceLineNumber === editingLine);
  if (!entry) return;
  const updated = upsertProperty(currentSource, entry, `EXCEPTION-NOTE-${editingBaseDate}`, text);
  const ok = await persistSource(updated);
  if (ok) refreshOccurrenceSection();
}

async function clearException(which: "override" | "note"): Promise<void> {
  if (editingLine === null || editingBaseDate === null) return;
  const entry = entries.find(e => e.sourceLineNumber === editingLine);
  if (!entry) return;
  const key = which === "override"
    ? `EXCEPTION-${editingBaseDate}`
    : `EXCEPTION-NOTE-${editingBaseDate}`;
  const updated = removeProperty(currentSource, entry, key);
  const ok = await persistSource(updated);
  if (ok) refreshOccurrenceSection();
}

function closeAddPanel(): void {
  if (!addPanelEl || !addOverlayEl) return;
  addOverlayEl.classList.remove("is-open");
  addPanelEl.classList.remove("is-open");
}

// ── Bootstrap ────────────────────────────────────────────────────────

async function init(): Promise<void> {
  buildAddPanel();
  setupNavigation();
  startClockTicker();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (addPanelEl?.classList.contains("is-open")) closeAddPanel();
    }
  });

  document.addEventListener("notification-toggled", () => {
    if (agendaLoaded) render();
  });

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

  const ghLink = document.createElement("a");
  ghLink.className = "github-link";
  ghLink.href = "https://github.com/Lycomedes1814/Mediant";
  ghLink.target = "_blank";
  ghLink.rel = "noopener noreferrer";
  ghLink.setAttribute("aria-label", "View on GitHub");
  ghLink.innerHTML = `<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

  const headerRight = document.createElement("div");
  headerRight.className = "input-header-right";
  headerRight.append(ghLink, createThemeToggle());

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

  // Re-fetch when the window regains focus — catches edits made while the
  // tab was in the background (e.g. editing the .org file in Emacs).
  window.addEventListener("focus", () => void reloadFromServer());
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

  // Schedule notifications for today's timed events
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const notifItems: { title: string; dateStr: string; startTime: string }[] = [];
  for (const day of week) {
    for (const item of day.items) {
      if (item.startTime) {
        const d = item.date;
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (ds === todayStr) {
          notifItems.push({ title: item.entry.title, dateStr: ds, startTime: item.startTime });
        }
      }
    }
  }
  scheduleNotifications(notifItems);
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
    } else if (action === "add") {
      openAddPanel();
    } else if (action === "edit") {
      const line = Number(btn.dataset.line);
      const baseDate = btn.dataset.baseDate ?? null;
      if (line) openEditPanel(line, baseDate);
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
