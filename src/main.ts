import { parseOrg } from "./org/parser.ts";
import { upsertProperty, removeProperty } from "./org/drawer.ts";
import type { OrgEntry, RecurrenceException, RecurrenceOverride } from "./org/model.ts";
import {
  appendAgendaItemToSource,
  appendQuickCaptureToTasks,
  deleteOrgBlockInSource,
  replaceOrgBlockInSource,
  toggleCheckboxInSource,
  toggleDoneInSource,
} from "./org/sourceEdit.ts";
import { stepDate } from "./org/timestamp.ts";
import { generateWeek, collectDeadlines, collectOverdueItems, collectSomedayItems } from "./agenda/generate.ts";
import { renderAgenda, createThemeToggle, openTagColorPicker } from "./ui/render.ts";
import type { AgendaWeek } from "./agenda/model.ts";
import { getTagColor } from "./ui/tagColors.ts";
import { scheduleNotifications } from "./ui/notifications.ts";
import { DAY_ABBREVS, MONTH_ABBREVS } from "./dateLabels.ts";

// ── Constants ───────────────────────────────────────────────────────

const MAX_INPUT_BYTES = 4 * 1024 * 1024; // 4 MB

// ── State ────────────────────────────────────────────────────────────

let entries = parseOrg("");
let currentStart = todayMidnight();
let currentSource = localStorage.getItem("mediant-org-source") ?? "";
let serverMode = false;
let serverVersion: string | null = null;
let agendaLoaded = false;
let activeTagFilters = new Set<string>();
let tagColorEditMode = false;
let hideEmptyDays = localStorage.getItem("mediant-hide-empty-days") === "true";

let quickCaptureOverlayEl: HTMLElement | null = null;
let quickCaptureInputEl: HTMLInputElement | null = null;
let quickCaptureErrorEl: HTMLElement | null = null;
let quickCaptureLastFocusEl: HTMLElement | null = null;

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
let lastPanelFocusEl: HTMLElement | null = null;
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
  onChange: (callback: (() => void) | null) => void;
}

interface DateTimeInput {
  container: HTMLElement;
  input: HTMLInputElement;
  preview: HTMLElement;
  datePicker: HTMLInputElement;
  timePicker: HTMLInputElement;
}

interface AddPanelRefs {
  typeGroup: HTMLElement;
  priorityGroup: HTMLElement;
  titleInput: HTMLInputElement;
  when: DateTimeInput;
  sched: DateTimeInput;
  dead: DateTimeInput;
  tagPicker: TagPicker;
  repeatSelect: HTMLSelectElement;
  schedRepeatSelect: HTMLSelectElement;
  deadRepeatSelect: HTMLSelectElement;
  checkboxSection: HTMLElement;
  syncVisibility: () => void;
  occurrenceSection: HTMLElement;
  occurrenceMeta: HTMLElement;
  occurrenceState: HTMLElement;
  skipCheckboxRow: HTMLElement;
  skipCheckbox: HTMLInputElement;
  endSeriesCheckboxRow: HTMLElement;
  endSeriesCheckbox: HTMLInputElement;
  occurrenceInput: HTMLInputElement;
  occurrencePreview: HTMLElement;
  noteTextarea: HTMLTextAreaElement;
  clearOverrideBtn: HTMLButtonElement;
}
let addPanelRefs: AddPanelRefs | null = null;
let queuedEditSource: string | null = null;
let queuedEditEpoch: number | null = null;
let inFlightEditSource: string | null = null;
let inFlightEditEpoch: number | null = null;
let editSaveInFlight = false;
let editSavePromise: Promise<boolean> | null = null;
let sourceEpoch = 0;

function buildQuickCaptureOverlay(): void {
  quickCaptureOverlayEl = document.createElement("div");
  quickCaptureOverlayEl.className = "quick-capture-overlay";
  quickCaptureOverlayEl.addEventListener("click", (e) => {
    if (e.target !== quickCaptureInputEl) closeQuickCapture();
  });

  quickCaptureInputEl = document.createElement("input");
  quickCaptureInputEl.type = "text";
  quickCaptureInputEl.className = "quick-capture-input";
  quickCaptureInputEl.placeholder = "Quick task capture";
  quickCaptureInputEl.autocomplete = "off";
  quickCaptureInputEl.spellcheck = true;
  quickCaptureInputEl.setAttribute("aria-label", "Quick task capture");
  quickCaptureInputEl.addEventListener("click", (e) => e.stopPropagation());
  quickCaptureInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submitQuickCapture();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeQuickCapture();
    }
  });

  quickCaptureErrorEl = document.createElement("div");
  quickCaptureErrorEl.className = "quick-capture-error";
  quickCaptureErrorEl.setAttribute("role", "status");

  quickCaptureOverlayEl.append(quickCaptureInputEl, quickCaptureErrorEl);
  document.body.appendChild(quickCaptureOverlayEl);
}

function openQuickCapture(): void {
  if (!quickCaptureOverlayEl || !quickCaptureInputEl || addPanelEl?.classList.contains("is-open") || !agendaLoaded) return;
  const active = document.activeElement;
  quickCaptureLastFocusEl = active instanceof HTMLElement && !quickCaptureOverlayEl.contains(active) ? active : null;
  if (quickCaptureErrorEl) quickCaptureErrorEl.textContent = "";
  quickCaptureOverlayEl.classList.add("is-open");
  quickCaptureInputEl.focus();
  quickCaptureInputEl.select();
}

function closeQuickCapture(): void {
  if (!quickCaptureOverlayEl || !quickCaptureInputEl) return;
  quickCaptureOverlayEl.classList.remove("is-open");
  quickCaptureInputEl.value = "";
  if (quickCaptureErrorEl) quickCaptureErrorEl.textContent = "";
  const target = quickCaptureLastFocusEl;
  quickCaptureLastFocusEl = null;
  if (target?.isConnected) target.focus();
}

function isQuickCaptureOpen(): boolean {
  return quickCaptureOverlayEl?.classList.contains("is-open") ?? false;
}

async function submitQuickCapture(): Promise<void> {
  if (!quickCaptureInputEl) return;
  const text = quickCaptureInputEl.value.trim();
  if (!text) return;

  const updated = appendQuickCaptureToTasks(currentSource, text);
  if (updated === currentSource) return;

  quickCaptureInputEl.disabled = true;
  if (quickCaptureErrorEl) quickCaptureErrorEl.textContent = "";
  try {
    const result = await persistSource(updated);
    if (result === "saved") {
      quickCaptureInputEl.value = "";
      quickCaptureInputEl.focus();
    } else if (quickCaptureErrorEl) {
      quickCaptureErrorEl.textContent = "Could not save task.";
    }
  } finally {
    quickCaptureInputEl.disabled = false;
    quickCaptureInputEl.focus();
  }
}

const EVENT_REPEAT_OPTIONS = [
  { value: "", label: "None" },
  { value: "+1d", label: "Every day (+1d)" },
  { value: "+1w", label: "Every week (+1w)" },
  { value: "+2w", label: "Every 2 weeks (+2w)" },
  { value: "+1m", label: "Every month (+1m)" },
  { value: "+1y", label: "Every year (+1y)" },
 ] as const;

const TODO_REPEAT_OPTIONS = [
  ...EVENT_REPEAT_OPTIONS,
  { value: "++1d", label: "Next future day (++1d)" },
  { value: "++1w", label: "Next future week (++1w)" },
  { value: "++1m", label: "Next future month (++1m)" },
  { value: "++1y", label: "Next future year (++1y)" },
  { value: ".+1d", label: "1 day from done (.+1d)" },
  { value: ".+1w", label: "1 week from done (.+1w)" },
  { value: ".+1m", label: "1 month from done (.+1m)" },
  { value: ".+1y", label: "1 year from done (.+1y)" },
] as const;

function hasParsedDate(input: HTMLInputElement): boolean {
  return Boolean(parseDateTime(input.value.trim())?.date);
}

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
    { value: "event", label: "Event", checked: true },
    { value: "todo", label: "TODO" },
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
    scheduleEditAutosave();
  }));

  // Title
  const titleInput = makeTextInput("Title", "add-title");
  form.appendChild(titleInput.container);

  // Event: when
  const whenInput = makeDateTimeInput("When", "add-when", {
    onChange: () => scheduleEditAutosave(),
  });
  form.appendChild(whenInput.container);

  // TODO: scheduled / deadline (combined date+time)
  const schedInput = makeDateTimeInput("Scheduled", "add-sched", {
    onChange: () => {
      syncVisibility();
      scheduleEditAutosave();
    },
  });
  form.appendChild(schedInput.container);

  const deadInput = makeDateTimeInput("Deadline", "add-dead", {
    onChange: () => {
      syncVisibility();
      scheduleEditAutosave();
    },
  });
  form.appendChild(deadInput.container);

  // Repeat (event only)
  const repeatSelect = makeSelect("Repeat", "add-repeat", [...EVENT_REPEAT_OPTIONS]);
  form.appendChild(repeatSelect.container);

  const schedRepeatSelect = makeSelect("Scheduled repeat", "add-sched-repeat", [...TODO_REPEAT_OPTIONS]);
  form.appendChild(schedRepeatSelect.container);

  const deadRepeatSelect = makeSelect("Deadline repeat", "add-dead-repeat", [...TODO_REPEAT_OPTIONS]);
  form.appendChild(deadRepeatSelect.container);

  // Tags
  const tagPicker = makeTagPicker("Tags", "add-tags");
  form.appendChild(tagPicker.container);

  // Show/hide fields based on type
  const typeRadios = typeGroup.container.querySelectorAll<HTMLInputElement>("input[name='add-type']");
  const syncVisibility = (): void => {
    const isTodo = checkedRadioValue(typeGroup.container, "add-type", "event") === "todo";
    const hasSchedDate = hasParsedDate(schedInput.input);
    const hasDeadDate = hasParsedDate(deadInput.input);
    whenInput.container.style.display = isTodo ? "none" : "";
    repeatSelect.container.style.display = isTodo ? "none" : "";
    schedInput.container.style.display = isTodo ? "" : "none";
    schedRepeatSelect.container.style.display = isTodo && hasSchedDate ? "" : "none";
    deadInput.container.style.display = isTodo ? "" : "none";
    deadRepeatSelect.container.style.display = isTodo && hasDeadDate ? "" : "none";
    checkboxSection.style.display = isTodo ? "" : "none";
    updateDateTimePreview(whenInput.input, whenInput.preview);
    updateDateTimePreview(schedInput.input, schedInput.preview);
    updateDateTimePreview(deadInput.input, deadInput.preview);
  };
  typeRadios.forEach(r => r.addEventListener("change", () => {
    syncVisibility();
    scheduleEditAutosave();
  }));

  titleInput.input.addEventListener("input", scheduleEditAutosave);
  repeatSelect.select.addEventListener("change", () => {
    syncVisibility();
    scheduleEditAutosave();
  });
  schedRepeatSelect.select.addEventListener("change", () => {
    syncVisibility();
    scheduleEditAutosave();
  });
  deadRepeatSelect.select.addEventListener("change", () => {
    syncVisibility();
    scheduleEditAutosave();
  });
  tagPicker.onChange(scheduleEditAutosave);

  // Checkbox section
  const checkboxSection = document.createElement("div");
  checkboxSection.className = "add-field edit-checkboxes";
  form.appendChild(checkboxSection);
  syncVisibility();

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
  endSeriesCheckboxText.textContent = "Stop repeating after this occurrence";
  endSeriesCheckbox.addEventListener("change", () => void toggleOccurrenceIsLast());
  endSeriesCheckboxRow.append(endSeriesCheckbox, endSeriesCheckboxText);

  const overrideRow = document.createElement("div");
  overrideRow.className = "occurrence-row";
  const occurrenceInput = document.createElement("input");
  occurrenceInput.type = "text";
  occurrenceInput.className = "add-input occurrence-input";
  occurrenceInput.placeholder = "Move to date/time";
  const occurrencePreview = document.createElement("div");
  occurrencePreview.className = "datetime-preview occurrence-preview";
  occurrenceInput.addEventListener("input", () => {
    updateDateTimePreview(occurrenceInput, occurrencePreview, editingBaseDate ?? undefined);
    const value = parseOccurrenceOverrideInput(occurrenceInput.value, editingBaseDate);
    if (value) void applyOverride(value, { resetInput: false });
  });
  overrideRow.append(occurrenceInput);

  const clearOverrideBtn = document.createElement("button");
  clearOverrideBtn.type = "button";
  clearOverrideBtn.className = "occurrence-btn occurrence-btn-secondary";
  clearOverrideBtn.textContent = "Clear override";
  clearOverrideBtn.addEventListener("click", () => clearException("override"));

  occActions.append(skipCheckboxRow, endSeriesCheckboxRow, overrideRow, occurrencePreview, clearOverrideBtn);
  occurrenceSection.appendChild(occActions);

  const noteLabel = document.createElement("label");
  noteLabel.className = "add-label";
  noteLabel.textContent = "Note for this occurrence";
  occurrenceSection.appendChild(noteLabel);

  const noteTextarea = document.createElement("textarea");
  noteTextarea.className = "occurrence-note";
  noteTextarea.rows = 2;
  noteTextarea.addEventListener("input", () => {
    const text = noteTextarea.value.trim();
    if (text) void applyNote(text);
    else void clearException("note");
  });
  occurrenceSection.appendChild(noteTextarea);

  // Save button
  const saveBtn = document.createElement("button");
  saveBtn.className = "add-save-btn";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    const orgText = buildPanelOrgText({ focusInvalid: true });
    if (orgText === null) return;

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
    when: whenInput,
    sched: schedInput,
    dead: deadInput,
    tagPicker,
    repeatSelect: repeatSelect.select,
    schedRepeatSelect: schedRepeatSelect.select,
    deadRepeatSelect: deadRepeatSelect.select,
    checkboxSection,
    syncVisibility,
    occurrenceSection,
    occurrenceMeta,
    occurrenceState,
    skipCheckboxRow,
    skipCheckbox,
    endSeriesCheckboxRow,
    endSeriesCheckbox,
    occurrenceInput,
    occurrencePreview,
    noteTextarea,
    clearOverrideBtn,
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
    if (item.checked) text.classList.add("edit-checkbox-done");
    text.addEventListener("input", () => {
      editingCheckboxItems[ci].text = text.value;
      scheduleEditAutosave();
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
    scheduleEditAutosave();
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
  input.autocomplete = "off";

  const dropdown = document.createElement("div");
  dropdown.className = "tag-picker-dropdown";

  wrapper.append(pillsEl, input, dropdown);
  wrapper.addEventListener("click", () => input.focus());
  container.append(lbl, wrapper);

  let selected: string[] = [];
  let activeOptionIndex = -1;
  let selectActiveOption: (() => void) | null = null;
  let onChange: (() => void) | null = null;

  const notifyChange = (): void => {
    onChange?.();
  };

  function updateActiveOption(nextIndex: number): void {
    const options = Array.from(dropdown.querySelectorAll<HTMLElement>(".tag-picker-option"));
    if (options.length === 0) {
      activeOptionIndex = -1;
      selectActiveOption = null;
      return;
    }
    activeOptionIndex = ((nextIndex % options.length) + options.length) % options.length;
    options.forEach((opt, idx) => {
      const isActive = idx === activeOptionIndex;
      opt.classList.toggle("is-active", isActive);
      opt.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    selectActiveOption = options[activeOptionIndex].dataset.selectIndex
      ? optionActions[Number(options[activeOptionIndex].dataset.selectIndex)] ?? null
      : null;
  }

  let optionActions: Array<() => void> = [];

  function renderPills(): void {
    pillsEl.innerHTML = "";
    for (const tag of selected) {
      const pill = document.createElement("span");
      pill.className = "tag-picker-pill";
      pill.style.setProperty("--tag-color", getTagColor(tag));

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
        notifyChange();
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
    optionActions = [];
    for (const tag of matches) {
      const opt = document.createElement("div");
      opt.className = "tag-picker-option";
      opt.textContent = tag;
      const swatch = document.createElement("span");
      swatch.className = "tag-picker-swatch";
      swatch.style.setProperty("--tag-color", getTagColor(tag));
      opt.prepend(swatch);
      const select = (): void => {
        selected.push(tag);
        input.value = "";
        renderPills();
        showDropdown();
        notifyChange();
      };
      opt.dataset.selectIndex = String(optionActions.push(select) - 1);
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus on input
        select();
      });
      dropdown.appendChild(opt);
    }

    // Show "add new" option if query doesn't match existing and isn't already selected
    if (query && !collectAllTags().some(t => t.toLowerCase() === query) && !selected.some(t => t.toLowerCase() === query)) {
      const addOpt = document.createElement("div");
      addOpt.className = "tag-picker-option tag-picker-option-new";
      addOpt.textContent = `Add "${input.value.trim()}"`;
      const select = (): void => {
        selected.push(input.value.trim());
        input.value = "";
        renderPills();
        showDropdown();
        notifyChange();
      };
      addOpt.dataset.selectIndex = String(optionActions.push(select) - 1);
      addOpt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        select();
      });
      dropdown.appendChild(addOpt);
    }

    const hasOptions = dropdown.children.length > 0;
    dropdown.style.display = hasOptions ? "block" : "none";
    if (!hasOptions) {
      activeOptionIndex = -1;
      selectActiveOption = null;
      return;
    }
    updateActiveOption(activeOptionIndex >= 0 ? activeOptionIndex : 0);
  }

  input.addEventListener("focus", showDropdown);
  input.addEventListener("input", showDropdown);
  input.addEventListener("blur", () => {
    dropdown.style.display = "none";
    activeOptionIndex = -1;
    selectActiveOption = null;
  });

  // Backspace on empty input removes last pill
  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !input.value && selected.length > 0) {
      selected.pop();
      renderPills();
      showDropdown();
      notifyChange();
      return;
    }
    if (e.key === "ArrowDown") {
      if (dropdown.children.length > 0) {
        e.preventDefault();
        updateActiveOption(activeOptionIndex + 1);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      if (dropdown.children.length > 0) {
        e.preventDefault();
        updateActiveOption(activeOptionIndex - 1);
      }
      return;
    }
    // Enter commits typed text as new tag
    if (e.key === "Enter") {
      if (selectActiveOption) {
        e.preventDefault();
        selectActiveOption();
        return;
      }
      const val = input.value.trim();
      if (val && !selected.some(t => t.toLowerCase() === val.toLowerCase())) {
        e.preventDefault();
        selected.push(val);
        input.value = "";
        renderPills();
        showDropdown();
        notifyChange();
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
    onChange: (callback: (() => void) | null) => {
      onChange = callback;
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

function selectRadioValue(container: HTMLElement, value: string): void {
  const radios = container.querySelectorAll<HTMLInputElement>("input[type='radio']");
  radios.forEach(radio => {
    radio.checked = radio.value === value;
  });
}

function checkedRadioValue(container: HTMLElement, name: string, fallback: string): string {
  const radios = Array.from(container.querySelectorAll<HTMLInputElement>(`input[name='${name}']`));
  return radios.find(radio => radio.checked)?.value ?? fallback;
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
  const fmt = (d: Date): string => {
    if (!Number.isFinite(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const validateDateParts = (year: number, month: number, day: number): string => {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    const candidate = new Date(year, month - 1, day);
    if (!Number.isFinite(candidate.getTime())) return "";
    if (
      candidate.getFullYear() !== year
      || candidate.getMonth() !== month - 1
      || candidate.getDate() !== day
    ) return "";
    return fmt(candidate);
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const full = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (full) {
    const yearRaw = Number(full[3]);
    const year = full[3].length === 2 ? 2000 + yearRaw : yearRaw;
    return validateDateParts(year, Number(full[2]), Number(full[1]));
  }
  const dm = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    const thisYear = validateDateParts(now.getFullYear(), month, day);
    if (thisYear) {
      const [year, candidateMonth, date] = thisYear.split("-").map(Number);
      const candidate = new Date(year, candidateMonth - 1, date);
      if (candidate >= today) return thisYear;
    }
    return validateDateParts(now.getFullYear() + 1, month, day);
  }
  const d = raw.match(/^(\d{1,2})$/);
  if (d) {
    const day = Number(d[1]);
    const thisMonth = validateDateParts(now.getFullYear(), now.getMonth() + 1, day);
    if (thisMonth) {
      const [year, month, date] = thisMonth.split("-").map(Number);
      const candidate = new Date(year, month - 1, date);
      if (candidate >= today) return thisMonth;
    }
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return validateDateParts(nextMonth.getFullYear(), nextMonth.getMonth() + 1, day);
  }

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

function makeDateTimeInput(
  label: string,
  id: string,
  options: { onChange?: () => void } = {},
): DateTimeInput {
  const container = document.createElement("div");
  container.className = "add-field";

  const lbl = document.createElement("label");
  lbl.className = "add-label";
  lbl.htmlFor = id;
  lbl.textContent = label;

  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.className = "add-input datetime-text-input";

  const inputWrap = document.createElement("div");
  inputWrap.className = "datetime-input-wrap";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "datetime-picker-toggle";
  toggleBtn.setAttribute("aria-label", `Open ${label.toLowerCase()} picker`);
  toggleBtn.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5a.75.75 0 0 1 1.5 0V3h5V1.5a.75.75 0 0 1 1.5 0V3h.75A2.25 2.25 0 0 1 15 5.25v7.5A2.25 2.25 0 0 1 12.75 15h-9.5A2.25 2.25 0 0 1 1 12.75v-7.5A2.25 2.25 0 0 1 3.25 3H4V1.5ZM2.5 6v6.75c0 .414.336.75.75.75h9.5a.75.75 0 0 0 .75-.75V6h-11Z"/></svg>`;

  const pickerPopover = document.createElement("div");
  pickerPopover.className = "datetime-picker-popover";

  const datePicker = document.createElement("input");
  datePicker.type = "date";
  datePicker.className = "add-input datetime-picker-input";

  const timePicker = document.createElement("input");
  timePicker.type = "time";
  timePicker.className = "add-input datetime-picker-input";
  timePicker.step = "60";

  pickerPopover.append(datePicker, timePicker);

  const closePopover = (): void => {
    pickerPopover.classList.remove("is-open");
    toggleBtn.classList.remove("is-open");
  };
  toggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const willOpen = !pickerPopover.classList.contains("is-open");
    document.querySelectorAll<HTMLElement>(".datetime-picker-popover.is-open")
      .forEach(pop => pop.classList.remove("is-open"));
    document.querySelectorAll<HTMLElement>(".datetime-picker-toggle.is-open")
      .forEach(btn => btn.classList.remove("is-open"));
    if (willOpen) {
      pickerPopover.classList.add("is-open");
      toggleBtn.classList.add("is-open");
    }
  });
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Node) || inputWrap.contains(e.target)) return;
    closePopover();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePopover();
  });

  const preview = document.createElement("div");
  preview.className = "datetime-preview";

  input.addEventListener("input", () => {
    updateDateTimePreview(input, preview);
    syncPickersFromText(input, datePicker, timePicker);
    options.onChange?.();
  });
  const syncFromPicker = (): void => {
    syncTextFromPickers(input, preview, datePicker, timePicker);
    options.onChange?.();
  };
  datePicker.addEventListener("input", syncFromPicker);
  timePicker.addEventListener("input", syncFromPicker);

  inputWrap.append(input, toggleBtn, pickerPopover);
  container.append(lbl, inputWrap, preview);
  return { container, input, preview, datePicker, timePicker };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(-([01]\d|2[0-3]):[0-5]\d)?$/;

/**
 * Parse a combined date/time field. Accepts "<date>" or "<date> <time>".
 * Date forms: DD, DD/MM, DD/MM/YYYY. Time forms: HH:MM or HH:MM-HH:MM.
 * Returns null on invalid input.
 */
function parseDateTime(raw: string, fallbackDate?: string): { date: string; time: string } | null {
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
    if (fallbackDate) return { date: fallbackDate, time };
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return { date: today, time };
  }
  const date = expandDate(dateRaw);
  if (!date) return null;
  return { date, time };
}

function formatPreviewDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const dt = new Date(year, month - 1, day);
  if (!Number.isFinite(dt.getTime())) return "";
  const dayName = DAY_ABBREVS[dt.getDay()];
  const monthName = MONTH_ABBREVS[dt.getMonth()];
  return `${dayName} ${day} ${monthName} ${year}`;
}

function formatDateTimePreview(raw: string, fallbackDate?: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const parsed = parseDateTime(trimmed, fallbackDate);
  if (!parsed?.date) return "";

  const dateText = formatPreviewDate(parsed.date);
  if (!dateText) return "";
  return parsed.time ? `${dateText}, ${parsed.time}` : dateText;
}

function updateDateTimePreview(input: HTMLInputElement, preview: HTMLElement, fallbackDate?: string): void {
  const text = formatDateTimePreview(input.value, fallbackDate);
  preview.textContent = text;
  preview.classList.toggle("is-visible", text !== "");
}

function splitDateTimeForPickers(raw: string): { date: string; time: string } {
  const parsed = parseDateTime(raw);
  if (!parsed?.date) return { date: "", time: "" };
  return {
    date: parsed.date,
    time: TIME_RE.test(parsed.time) && !parsed.time.includes("-") ? parsed.time : "",
  };
}

function syncPickersFromText(
  input: HTMLInputElement,
  datePicker: HTMLInputElement,
  timePicker: HTMLInputElement,
): void {
  const parts = splitDateTimeForPickers(input.value.trim());
  datePicker.value = parts.date;
  timePicker.value = parts.time;
}

function syncTextFromPickers(
  input: HTMLInputElement,
  preview: HTMLElement,
  datePicker: HTMLInputElement,
  timePicker: HTMLInputElement,
): void {
  const date = datePicker.value.trim();
  const time = timePicker.value.trim();
  input.value = date ? (time ? `${isoToDisplayDate(date)} ${time}` : isoToDisplayDate(date)) : "";
  updateDateTimePreview(input, preview);
}

function syncDateTimeInput(field: DateTimeInput): void {
  updateDateTimePreview(field.input, field.preview);
  syncPickersFromText(field.input, field.datePicker, field.timePicker);
}

function parseOccurrenceOverrideInput(raw: string, baseDate: string | null): string | null {
  const trimmed = raw.trim();
  const parsed = parseDateTime(trimmed, baseDate ?? undefined);
  if (!parsed || !parsed.date) return null;
  const timePart = parsed.time ? ` ${parsed.time}` : "";
  return `reschedule ${parsed.date}${timePart}`;
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

function buildPanelOrgText(opts: { focusInvalid: boolean }): string | null {
  if (!addPanelRefs) return null;
  const refs = addPanelRefs;
  const type = checkedRadioValue(refs.typeGroup, "add-type", "event");
  const heading = refs.titleInput.value.trim();
  if (!heading) {
    if (opts.focusInvalid) refs.titleInput.focus();
    return null;
  }
  const tagsVal = refs.tagPicker.getTags().join(", ");

  const readDateTime = (input: HTMLInputElement): { date: string; time: string } | null => {
    const raw = input.value.trim();
    if (!raw) return { date: "", time: "" };
    const parsed = parseDateTime(raw);
    if (!parsed) {
      if (opts.focusInvalid) input.focus();
      return null;
    }
    return parsed;
  };

  if (type === "event") {
    editingProgress = null;
    const dt = readDateTime(refs.when.input);
    if (dt === null) return null;
    if (!dt.date) {
      if (opts.focusInvalid) refs.when.input.focus();
      return null;
    }
    return buildOrgText({
      type: "event",
      level: editingLevel,
      heading,
      tags: tagsVal,
      priority: editingPriority,
      progress: editingProgress,
      date: dt.date,
      time: dt.time,
      repeater: refs.repeatSelect.value || null,
    });
  }

  const checkboxItems = editingCheckboxItems.filter(ci => ci.text.trim() !== "");
  editingProgress = checkboxItems.length > 0
    ? { done: checkboxItems.filter(ci => ci.checked).length, total: checkboxItems.length }
    : null;

  const scheduled = readDateTime(refs.sched.input);
  if (scheduled === null) return null;
  const deadline = readDateTime(refs.dead.input);
  if (deadline === null) return null;
  return buildOrgText({
    type: "todo",
    level: editingLevel,
    heading,
    tags: tagsVal,
    todoState: editingTodoState,
    priority: editingPriority,
    progress: editingProgress,
    schedDate: scheduled.date,
    schedTime: scheduled.time,
    schedRepeater: scheduled.date ? (refs.schedRepeatSelect.value || null) : null,
    deadDate: deadline.date,
    deadTime: deadline.time,
    deadRepeater: deadline.date ? (refs.deadRepeatSelect.value || null) : null,
    checkboxItems,
  });
}

function editSaveBaseSource(): string {
  if (queuedEditSource !== null && queuedEditEpoch === sourceEpoch) return queuedEditSource;
  if (inFlightEditSource !== null && inFlightEditEpoch === sourceEpoch) return inFlightEditSource;
  return currentSource;
}

function editSaveBaseEpoch(): number {
  return sourceEpoch;
}

function rememberFocusBeforePanelOpen(): void {
  const active = document.activeElement;
  lastPanelFocusEl = active instanceof HTMLElement && !addPanelEl?.contains(active) ? active : null;
}

function restoreFocusAfterPanelClose(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && addPanelEl?.contains(active)) {
    active.blur();
  }
  const target = lastPanelFocusEl;
  lastPanelFocusEl = null;
  if (target && target.isConnected) {
    target.focus();
  }
}

function queueEditSourceSave(updated: string): Promise<boolean> {
  if (updated === editSaveBaseSource()) return editSavePromise ?? Promise.resolve(true);
  queuedEditSource = updated;
  queuedEditEpoch = editSaveBaseEpoch();
  if (editSaveInFlight && editSavePromise) return editSavePromise;
  editSavePromise = drainEditSourceSaves();
  return editSavePromise;
}

async function drainEditSourceSaves(): Promise<boolean> {
  editSaveInFlight = true;
  let ok = true;
  try {
    while (queuedEditSource !== null) {
      const next = queuedEditSource;
      const nextEpoch = queuedEditEpoch ?? sourceEpoch;
      queuedEditSource = null;
      queuedEditEpoch = null;
      if (next === currentSource) continue;
      if (nextEpoch !== sourceEpoch) {
        ok = false;
        continue;
      }
      inFlightEditSource = next;
      inFlightEditEpoch = nextEpoch;
      let result: "saved" | "stale" | "failed";
      try {
        result = await persistSource(next, { expectedEpoch: nextEpoch });
      } finally {
        inFlightEditSource = null;
        inFlightEditEpoch = null;
      }
      if (result === "failed") {
        queuedEditSource = null;
        queuedEditEpoch = null;
        ok = false;
        break;
      }
      if (result !== "saved") ok = false;
    }
    return ok;
  } finally {
    editSaveInFlight = false;
    editSavePromise = null;
  }
}

function scheduleEditAutosave(): void {
  if (editingLine === null || !addPanelEl?.classList.contains("is-editing")) return;
  const orgText = buildPanelOrgText({ focusInvalid: false });
  if (orgText === null) return;
  const updated = replaceOrgBlockInSource(editSaveBaseSource(), editingLine, orgText);
  void queueEditSourceSave(updated);
}

function formatRepeaterValue(
  repeater: { mark: "+" | ".+" | "++"; value: number; unit: "d" | "w" | "m" | "y" } | null | undefined,
): string {
  return repeater ? `${repeater.mark}${repeater.value}${repeater.unit}` : "";
}

function replaceOrgBlock(sourceLine: number, newText: string): void {
  const updated = replaceOrgBlockInSource(currentSource, sourceLine, newText);
  void persistSource(updated);
}

async function toggleDone(sourceLine: number): Promise<void> {
  await persistSource(toggleDoneInSource(currentSource, sourceLine));
}

async function toggleCheckbox(parentSourceLine: number, index: number): Promise<void> {
  await persistSource(toggleCheckboxInSource(currentSource, parentSourceLine, index));
}

function deleteOrgBlock(sourceLine: number): void {
  void persistSource(deleteOrgBlockInSource(currentSource, sourceLine));
}

function appendOrgText(orgText: string): void {
  void persistSource(appendAgendaItemToSource(currentSource, orgText));
}

function openAddPanel(prefillDate: string | null = null): void {
  if (!addPanelEl || !addOverlayEl || !addPanelRefs) return;
  rememberFocusBeforePanelOpen();

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
  refs.when.input.value = isoToDisplayDate(prefillDate ?? "");
  refs.sched.input.value = "";
  refs.dead.input.value = "";
  syncDateTimeInput(refs.when);
  syncDateTimeInput(refs.sched);
  syncDateTimeInput(refs.dead);
  refs.tagPicker.setTags([]);
  refs.repeatSelect.value = "";
  refs.schedRepeatSelect.value = "";
  refs.deadRepeatSelect.value = "";
  rebuildCheckboxUI(refs.checkboxSection);
  selectRadioValue(refs.typeGroup, "event");
  refs.typeGroup.style.display = "";
  selectRadioValue(refs.priorityGroup, "");
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
  rememberFocusBeforePanelOpen();

  const entry = entries.find(e => e.sourceLineNumber === sourceLine);
  if (!entry) return;

  editingLine = sourceLine;
  editingBaseDate = baseDate;
  editingLevel = entry.level;
  editingPriority = entry.priority;
  editingTodoState = entry.todo === "DONE" ? "DONE" : "TODO";
  editingProgress = entry.progress;
  if (addPanelSaveBtnEl) addPanelSaveBtnEl.textContent = "Save";
  addPanelEl.classList.add("is-editing");
  addPanelEl.classList.toggle("has-occurrence", baseDate !== null && entryHasRepeater(entry));
  refreshOccurrenceSection({ resetOccurrenceInput: true });

  const refs = addPanelRefs;

  const type = entry.todo ? "todo" : "event";
  if (addPanelTitleEl) addPanelTitleEl.textContent = type === "todo" ? "Edit task" : "Edit event";
  selectRadioValue(refs.typeGroup, type);
  refs.typeGroup.style.display = "none";

  refs.titleInput.value = entry.title;
  refs.tagPicker.setTags([...entry.tags]);

  const prioVal = entry.priority ?? "";
  selectRadioValue(refs.priorityGroup, prioVal);

  refs.when.input.value = "";
  refs.sched.input.value = "";
  refs.dead.input.value = "";
  refs.repeatSelect.value = "";
  refs.schedRepeatSelect.value = "";
  refs.deadRepeatSelect.value = "";
  editingSchedRepeater = null;
  editingDeadRepeater = null;

  if (type === "event") {
    const ts = entry.timestamps[0] ?? null;
    if (ts) {
      refs.when.input.value = tsToDateTimeDisplay(ts);
      refs.repeatSelect.value = formatRepeaterValue(ts.repeater);
    }
  } else {
    const sched = entry.planning.find(p => p.kind === "scheduled");
    const deadline = entry.planning.find(p => p.kind === "deadline");
    if (sched) {
      refs.sched.input.value = tsToDateTimeDisplay(sched.timestamp);
      refs.schedRepeatSelect.value = formatRepeaterValue(sched.timestamp.repeater);
      editingSchedRepeater = sched.timestamp.repeater
        ? formatRepeaterValue(sched.timestamp.repeater) : null;
    }
    if (deadline) {
      refs.dead.input.value = tsToDateTimeDisplay(deadline.timestamp);
      refs.deadRepeatSelect.value = formatRepeaterValue(deadline.timestamp.repeater);
      editingDeadRepeater = deadline.timestamp.repeater
        ? formatRepeaterValue(deadline.timestamp.repeater) : null;
    }
  }

  syncDateTimeInput(refs.when);
  syncDateTimeInput(refs.sched);
  syncDateTimeInput(refs.dead);

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
  const next = stepDate(new Date(year, month - 1, day, 0, 0, 0, 0), ts.repeater.value, ts.repeater.unit);
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

function describeOverride(override: RecurrenceOverride, baseDate: string | null = null): string {
  if (override.kind === "cancelled") return "Skipped";
  if (override.kind === "shift") {
    const m = override.offsetMinutes;
    const sign = m >= 0 ? "+" : "-";
    const abs = Math.abs(m);
    if (abs % 1440 === 0) return `Moved ${sign}${abs / 1440}d`;
    if (abs % 60 === 0) return `Moved ${sign}${abs / 60}h`;
    return `Moved ${sign}${abs}m`;
  }
  // reschedule
  const sameDate = baseDate !== null && override.date === baseDate;
  let out = "Moved to";
  if (!sameDate) {
  const [y, mo, d] = override.date.split("-").map(Number);
    const dt = new Date(y, mo - 1, d);
    const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()];
    const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][dt.getMonth()];
    out += ` ${dayName} ${dt.getDate()} ${monthName}`;
  }
  if (override.startTime) {
    out += sameDate
      ? ` ${override.endTime ? `${override.startTime}–${override.endTime}` : override.startTime}`
      : override.endTime
        ? `, ${override.startTime}–${override.endTime}`
        : `, ${override.startTime}`;
  }
  return out;
}

function refreshOccurrenceSection(opts: { resetOccurrenceInput?: boolean } = {}): void {
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
    ? describeOverride(override, editingBaseDate)
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

  // Autosave stores parsed notes trimmed, so avoid normalizing a focused
  // textarea while the user is typing a space before the next word.
  if (document.activeElement !== refs.noteTextarea && refs.noteTextarea.value !== (note ?? "")) {
    refs.noteTextarea.value = note ?? "";
  }
  if (opts.resetOccurrenceInput) {
    refs.occurrenceInput.value = "";
    refs.occurrencePreview.textContent = "";
    refs.occurrencePreview.classList.remove("is-visible");
  }
}

async function toggleOccurrenceSkipped(): Promise<void> {
  if (editingLine === null || editingBaseDate === null || !addPanelRefs) return;
  const entry = entries.find(e => e.sourceLineNumber === editingLine);
  if (!entry) return;
  const baseSource = editSaveBaseSource();
  const updated = addPanelRefs.skipCheckbox.checked
    ? upsertProperty(baseSource, entry, `EXCEPTION-${editingBaseDate}`, "cancelled")
    : removeProperty(baseSource, entry, `EXCEPTION-${editingBaseDate}`);
  await queueEditSourceSave(updated);
  refreshOccurrenceSection({ resetOccurrenceInput: true });
}

async function toggleOccurrenceIsLast(): Promise<void> {
  if (editingLine === null || editingBaseDate === null || !addPanelRefs) return;
  const entry = entries.find(e => e.sourceLineNumber === editingLine);
  if (!entry) return;
  const nextBaseKey = nextOccurrenceBoundary(pickBaseTimestamp(entry), editingBaseDate);
  if (nextBaseKey === null) return;
  const baseSource = editSaveBaseSource();
  const updated = addPanelRefs.endSeriesCheckbox.checked
    ? upsertProperty(baseSource, entry, "SERIES-UNTIL", nextBaseKey)
    : removeProperty(baseSource, entry, "SERIES-UNTIL");
  await queueEditSourceSave(updated);
  refreshOccurrenceSection({ resetOccurrenceInput: true });
}

async function applyOverride(value: string, opts: { resetInput?: boolean } = {}): Promise<void> {
  if (editingLine === null || editingBaseDate === null) return;
  const entry = entries.find(e => e.sourceLineNumber === editingLine);
  if (!entry) return;
  const updated = upsertProperty(editSaveBaseSource(), entry, `EXCEPTION-${editingBaseDate}`, value);
  await queueEditSourceSave(updated);
  refreshOccurrenceSection({ resetOccurrenceInput: opts.resetInput ?? true });
}

async function applyNote(text: string): Promise<void> {
  if (editingLine === null || editingBaseDate === null) return;
  const entry = entries.find(e => e.sourceLineNumber === editingLine);
  if (!entry) return;
  const updated = upsertProperty(editSaveBaseSource(), entry, `EXCEPTION-NOTE-${editingBaseDate}`, text);
  await queueEditSourceSave(updated);
  refreshOccurrenceSection();
}

async function clearException(which: "override" | "note"): Promise<void> {
  if (editingLine === null || editingBaseDate === null) return;
  const entry = entries.find(e => e.sourceLineNumber === editingLine);
  if (!entry) return;
  const key = which === "override"
    ? `EXCEPTION-${editingBaseDate}`
    : `EXCEPTION-NOTE-${editingBaseDate}`;
  const updated = removeProperty(editSaveBaseSource(), entry, key);
  await queueEditSourceSave(updated);
  refreshOccurrenceSection({ resetOccurrenceInput: which === "override" });
}

function closeAddPanel(): void {
  if (!addPanelEl || !addOverlayEl) return;
  addOverlayEl.classList.remove("is-open");
  addPanelEl.classList.remove("is-open");
  restoreFocusAfterPanelClose();
}

function navigateWeek(direction: "prev" | "next" | "today"): void {
  if (direction === "prev") {
    currentStart.setDate(currentStart.getDate() - 7);
  } else if (direction === "next") {
    currentStart.setDate(currentStart.getDate() + 7);
  } else {
    currentStart = todayMidnight();
  }
  render();
}

function entryMatchesTagFilters(entry: Pick<OrgEntry, "tags">): boolean {
  if (activeTagFilters.size === 0) return true;
  return [...activeTagFilters].every(tag => entry.tags.includes(tag));
}

function filterWeekByTags(week: AgendaWeek): AgendaWeek {
  return week.map(day => ({
    ...day,
    items: day.items.filter(item => entryMatchesTagFilters(item.entry)),
  })) as unknown as AgendaWeek;
}

function filterByTags<T extends { entry: Pick<OrgEntry, "tags"> }>(items: T[]): T[] {
  return items.filter(item => entryMatchesTagFilters(item.entry));
}

function toggleTagFilter(tag: string): void {
  if (activeTagFilters.has(tag)) activeTagFilters.delete(tag);
  else activeTagFilters.add(tag);
  render();
}

function clearTagFilters(): void {
  if (activeTagFilters.size === 0) return;
  activeTagFilters.clear();
  render();
}

function toggleTagColorMode(): void {
  tagColorEditMode = !tagColorEditMode;
  render();
}

function toggleHideEmptyDays(): void {
  hideEmptyDays = !hideEmptyDays;
  localStorage.setItem("mediant-hide-empty-days", hideEmptyDays ? "true" : "false");
  render();
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("input, textarea, select, [contenteditable='true']"));
}

type ShortcutAction = "next" | "prev" | "today" | "add" | "quick-capture" | "color-mode" | "hide-empty-days" | "clear-filters";

const SHORTCUT_ACTIONS: Record<string, ShortcutAction> = {
  n: "next",
  p: "prev",
  t: "today",
  a: "add",
  q: "quick-capture",
  c: "color-mode",
  h: "hide-empty-days",
  x: "clear-filters",
};

function getShortcutAction(e: KeyboardEvent): ShortcutAction | null {
  return SHORTCUT_ACTIONS[e.key.toLowerCase()] ?? null;
}

// ── Bootstrap ────────────────────────────────────────────────────────

async function init(): Promise<void> {
  buildAddPanel();
  buildQuickCaptureOverlay();
  setupNavigation();
  startClockTicker();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (isQuickCaptureOpen()) {
        closeQuickCapture();
        return;
      }
      if (addPanelEl?.classList.contains("is-open")) closeAddPanel();
      return;
    }
    const actionEl = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("[data-action]") : null;
    if (actionEl && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      actionEl.click();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
    const action = getShortcutAction(e);
    if (action === "next") {
      e.preventDefault();
      navigateWeek("next");
    } else if (action === "prev") {
      e.preventDefault();
      navigateWeek("prev");
    } else if (action === "today") {
      e.preventDefault();
      navigateWeek("today");
    } else if (action === "add") {
      e.preventDefault();
      openAddPanel();
    } else if (action === "quick-capture") {
      e.preventDefault();
      openQuickCapture();
    } else if (action === "color-mode") {
      e.preventDefault();
      toggleTagColorMode();
    } else if (action === "hide-empty-days") {
      e.preventDefault();
      toggleHideEmptyDays();
    } else if (action === "clear-filters") {
      e.preventDefault();
      clearTagFilters();
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
  textarea.spellcheck = false;
  textarea.value = localStorage.getItem("mediant-org-source") ?? "";

  const btn = document.createElement("button");
  btn.className = "input-load-btn";
  btn.textContent = "Load agenda";
  btn.addEventListener("click", () => loadFromTextarea(textarea.value));

  const ghLink = document.createElement("a");
  ghLink.className = "github-link";
  ghLink.href = "https://github.com/Jovlang/Mediant";
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
async function persistSource(
  updated: string,
  opts: { expectedEpoch?: number } = {},
): Promise<"saved" | "stale" | "failed"> {
  if (exceedsLimit(updated)) {
    alert("Source exceeds the 4 MB limit.");
    return "failed";
  }

  if (serverMode) {
    const expectedEpoch = opts.expectedEpoch ?? sourceEpoch;
    try {
      const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8" };
      if (serverVersion) headers["If-Match"] = serverVersion;
      const r = await fetch("/api/source", { method: "PUT", headers, body: updated });
      if (r.status === 409) {
        alert("File was modified externally; reloading from disk.");
        await reloadFromServer();
        return "stale";
      }
      if (!r.ok) {
        alert(`Failed to save: ${r.status} ${r.statusText}`);
        return "failed";
      }
      if (sourceEpoch !== expectedEpoch) {
        await reloadFromServer();
        return "stale";
      }
      serverVersion = r.headers.get("X-Version");
      applyParsedSource(updated);
      render();
      return "saved";
    } catch (e) {
      alert(`Save failed: ${(e as Error).message}`);
      return "failed";
    }
  }

  localStorage.setItem("mediant-org-source", updated);
  applyParsedSource(updated);
  render();
  return "saved";
}

async function reloadFromServer(): Promise<void> {
  try {
    const r = await fetch("/api/source");
    if (!r.ok) return;
    const nextVersion = r.headers.get("X-Version");
    const nextSource = await r.text();
    if (nextVersion === serverVersion && nextSource === currentSource) return;
    serverVersion = nextVersion;
    queuedEditSource = null;
    queuedEditEpoch = null;
    sourceEpoch++;
    applyParsedSource(nextSource);
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

function applyParsedSource(source: string): void {
  currentSource = source;
  entries = parseOrg(source);
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
  const filteredWeek = filterWeekByTags(week);
  const filteredDeadlines = filterByTags(deadlines);
  const filteredOverdue = filterByTags(overdue);
  const filteredSomeday = filterByTags(someday);

  renderAgenda(container, filteredWeek, filteredDeadlines, filteredOverdue, filteredSomeday, today, {
    activeTagFilters: [...activeTagFilters].sort(),
    tagColorEditMode,
    hideEmptyDays,
  });

  // Schedule notifications for today's timed events
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const notifItems: { title: string; dateStr: string; startTime: string }[] = [];
  for (const day of filteredWeek) {
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
    const tagEl = (e.target as HTMLElement).closest<HTMLElement>(".tag[data-tag]");
    if (tagEl) {
      const tag = tagEl.dataset.tag;
      if (!tag) return;
      if (tagColorEditMode || e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        openTagColorPicker(tagEl);
        return;
      }
    }

    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (!action) return;

    if (action === "prev" || action === "next" || action === "today") {
      navigateWeek(action);
    } else if (action === "add") {
      openAddPanel();
      if (btn instanceof HTMLElement) {
        btn.blur();
        lastPanelFocusEl = null;
      }
    } else if (action === "add-on-date") {
      openAddPanel(btn.dataset.date ?? null);
      if (btn instanceof HTMLElement) {
        btn.blur();
        lastPanelFocusEl = null;
      }
    } else if (action === "toggle-tag-color-mode") {
      toggleTagColorMode();
    } else if (action === "toggle-hide-empty-days") {
      toggleHideEmptyDays();
    } else if (action === "toggle-tag-filter") {
      const tag = btn.dataset.tag;
      if (tag) toggleTagFilter(tag);
    } else if (action === "clear-tag-filters") {
      clearTagFilters();
    } else if (action === "edit") {
      const line = Number(btn.dataset.line);
      const baseDate = btn.dataset.baseDate ?? null;
      if (line) {
        openEditPanel(line, baseDate);
        if (btn instanceof HTMLElement) {
          btn.blur();
          lastPanelFocusEl = null;
        }
      }
    } else if (action === "toggle-done") {
      e.stopPropagation();
      const line = Number(btn.dataset.line);
      if (line) void toggleDone(line);
    } else if (action === "toggle-checkbox") {
      e.stopPropagation();
      const line = Number(btn.dataset.line);
      const index = Number(btn.dataset.checkboxIndex);
      if (line && Number.isInteger(index) && index >= 0) void toggleCheckbox(line, index);
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
