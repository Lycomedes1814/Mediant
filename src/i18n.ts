export type Locale = "en" | "nb";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "nb"] as const;

const LOCALE_STORAGE_KEY = "mediant-locale";

const messages = {
  en: {
    // Header / navigation
    today: "Today",
    todayAria: "Today",
    prev7Days: "Previous 7 days",
    next7Days: "Next 7 days",
    prev30Days: "Previous 30 days",
    next30Days: "Next 30 days",
    addLabel: "+Add",
    addAria: "Add item",
    settings: "Settings",
    viewOnGitHub: "View on GitHub",

    // Settings toggles
    toggleNotifications: "Toggle notifications",
    enableNotifications: "Enable notifications",
    disableNotifications: "Disable notifications",
    clickTagToFilter: "Click tag to filter",
    clickTagToChangeColor: "Click tag to change color",
    hideEmptyDays: "Hide empty days",
    showEmptyDays: "Show empty days",
    hideTags: "Hide tags",
    showTags: "Show tags",
    hideCompletedAndSkipped: "Hide completed & skipped",
    showCompletedAndSkipped: "Show completed & skipped",
    showTodoRings: "Show TODO rings",
    showTodoText: "Show TODO text",
    show7Days: "Show 7 days",
    show30Days: "Show 30 days",
    language: "Language",
    languageEnglish: "English",
    languageNorwegian: "Norsk",
    switchToEnglish: "Switch to English",
    switchToNorwegian: "Switch to Norsk",

    // Tag filters
    filtering: "Filtering:",
    clear: "Clear",
    filterByTag: "Filter by tag {tag}",
    removeTagFilter: "Remove tag filter {tag}",
    changeColorForTag: "Change color for tag {tag}",

    // Day rows
    addEventOn: "Add event on {date}",
    weekAbbrev: "W",
    overdue: "Overdue",
    deadline: "DEADLINE",
    overdueScheduled: "SCHEDULED",
    nowMarker: "◄ now",
    allDay: "All-day",
    markDone: "Mark done",
    markNotDone: "Mark not done",
    skippedDetail: "Skipped ({detail})",
    movedEarlier: "← Moved",
    movedLater: "→ Moved",
    showChecklist: "Show checklist",
    hideChecklist: "Hide checklist",

    // Add/edit panel — header and shared
    close: "Close",
    addItem: "Add item",
    editTask: "Edit task",
    editEvent: "Edit event",
    save: "Save",
    delete: "Delete",
    tapAgainToDelete: "Tap again to delete",

    // Add/edit panel — fields
    type: "Type",
    typeEvent: "Event",
    typeTodo: "Task",
    priority: "Priority",
    priorityNone: "None",
    title: "Title",
    when: "When",
    scheduled: "Scheduled",
    deadlineField: "Deadline",
    repeat: "Repeat",
    scheduledRepeat: "Scheduled repeat",
    deadlineRepeat: "Deadline repeat",
    tags: "Tags",
    checklist: "Checklist",
    addSubtask: "+ Add subtask",
    openPicker: "Open {label} picker",

    // Repeat options
    repeatNone: "None",
    repeatEveryDay: "Every day (+1d)",
    repeatEveryWeek: "Every week (+1w)",
    repeatEvery2Weeks: "Every 2 weeks (+2w)",
    repeatEveryMonth: "Every month (+1m)",
    repeatEveryYear: "Every year (+1y)",
    repeatNextFutureDay: "Next future day (++1d)",
    repeatNextFutureWeek: "Next future week (++1w)",
    repeatNextFutureMonth: "Next future month (++1m)",
    repeatNextFutureYear: "Next future year (++1y)",
    repeatDayFromDone: "1 day from done (.+1d)",
    repeatWeekFromDone: "1 week from done (.+1w)",
    repeatMonthFromDone: "1 month from done (.+1m)",
    repeatYearFromDone: "1 year from done (.+1y)",

    // Tag picker
    addTagOption: "Add \"{tag}\"",

    // Occurrence section
    skipThisOccurrence: "Skip this occurrence",
    stopRepeatingAfter: "Stop repeating after this occurrence",
    moveToDateTime: "Move to date/time",
    clearOverride: "Clear override",
    noteForOccurrence: "Note for this occurrence",

    // Quick capture
    quickTaskCapture: "Quick task capture",
    couldNotSaveTask: "Could not save task.",

    // Input screen
    appTitle: "Mediant",
    loadAgenda: "Load agenda",

    // Notifications
    notificationStartsIn1Hour: "Starts in 1 hour · {time}",
  },
  nb: {
    today: "I dag",
    todayAria: "I dag",
    prev7Days: "Forrige 7 dager",
    next7Days: "Neste 7 dager",
    prev30Days: "Forrige 30 dager",
    next30Days: "Neste 30 dager",
    addLabel: "+Legg til",
    addAria: "Legg til oppføring",
    settings: "Innstillinger",
    viewOnGitHub: "Se på GitHub",

    toggleNotifications: "Slå av/på varsler",
    enableNotifications: "Slå på varsler",
    disableNotifications: "Slå av varsler",
    clickTagToFilter: "Trykk på etikett for å filtrere",
    clickTagToChangeColor: "Trykk på etikett for å endre farge",
    hideEmptyDays: "Skjul tomme dager",
    showEmptyDays: "Vis tomme dager",
    hideTags: "Skjul etiketter",
    showTags: "Vis etiketter",
    hideCompletedAndSkipped: "Skjul fullførte og hoppet over",
    showCompletedAndSkipped: "Vis fullførte og hoppet over",
    showTodoRings: "Vis TODO-ringer",
    showTodoText: "Vis TODO-tekst",
    show7Days: "Vis 7 dager",
    show30Days: "Vis 30 dager",
    language: "Språk",
    languageEnglish: "English",
    languageNorwegian: "Norsk",
    switchToEnglish: "Bytt til English",
    switchToNorwegian: "Bytt til Norsk",

    filtering: "Filter:",
    clear: "Tøm",
    filterByTag: "Filtrer på etikett {tag}",
    removeTagFilter: "Fjern etikettfilter {tag}",
    changeColorForTag: "Endre farge for etikett {tag}",

    addEventOn: "Legg til hendelse {date}",
    weekAbbrev: "U",
    overdue: "Forfalt",
    deadline: "FRIST",
    overdueScheduled: "PLANLAGT",
    nowMarker: "◄ nå",
    allDay: "Hele dagen",
    markDone: "Marker som ferdig",
    markNotDone: "Marker som ikke ferdig",
    skippedDetail: "Hoppet over ({detail})",
    movedEarlier: "← Flyttet",
    movedLater: "→ Flyttet",
    showChecklist: "Vis sjekkliste",
    hideChecklist: "Skjul sjekkliste",

    close: "Lukk",
    addItem: "Legg til oppføring",
    editTask: "Rediger oppgave",
    editEvent: "Rediger hendelse",
    save: "Lagre",
    delete: "Slett",
    tapAgainToDelete: "Trykk igjen for å slette",

    type: "Type",
    typeEvent: "Hendelse",
    typeTodo: "Oppgave",
    priority: "Prioritet",
    priorityNone: "Ingen",
    title: "Tittel",
    when: "Når",
    scheduled: "Planlagt",
    deadlineField: "Frist",
    repeat: "Gjenta",
    scheduledRepeat: "Gjenta planlagt",
    deadlineRepeat: "Gjenta frist",
    tags: "Etiketter",
    checklist: "Sjekkliste",
    addSubtask: "+ Legg til deloppgave",
    openPicker: "Åpne {label}-velger",

    repeatNone: "Ingen",
    repeatEveryDay: "Hver dag (+1d)",
    repeatEveryWeek: "Hver uke (+1w)",
    repeatEvery2Weeks: "Annenhver uke (+2w)",
    repeatEveryMonth: "Hver måned (+1m)",
    repeatEveryYear: "Hvert år (+1y)",
    repeatNextFutureDay: "Neste fremtidige dag (++1d)",
    repeatNextFutureWeek: "Neste fremtidige uke (++1w)",
    repeatNextFutureMonth: "Neste fremtidige måned (++1m)",
    repeatNextFutureYear: "Neste fremtidige år (++1y)",
    repeatDayFromDone: "1 dag etter fullført (.+1d)",
    repeatWeekFromDone: "1 uke etter fullført (.+1w)",
    repeatMonthFromDone: "1 måned etter fullført (.+1m)",
    repeatYearFromDone: "1 år etter fullført (.+1y)",

    addTagOption: "Legg til «{tag}»",

    skipThisOccurrence: "Hopp over denne forekomsten",
    stopRepeatingAfter: "Slutt å gjenta etter denne forekomsten",
    moveToDateTime: "Flytt til dato/klokkeslett",
    clearOverride: "Fjern overstyring",
    noteForOccurrence: "Notat for denne forekomsten",

    quickTaskCapture: "Hurtigregistrering",
    couldNotSaveTask: "Kunne ikke lagre oppgaven.",

    appTitle: "Mediant",
    loadAgenda: "Last inn agenda",

    notificationStartsIn1Hour: "Starter om 1 time · {time}",
  },
} as const;

export type MessageKey = keyof typeof messages.en;

function detectInitialLocale(): Locale {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored === "en" || stored === "nb") return stored;
    }
  } catch {
    // localStorage may throw in some sandboxed contexts
  }
  if (typeof navigator !== "undefined") {
    const lang = (navigator.language ?? "").toLowerCase();
    if (lang.startsWith("nb") || lang.startsWith("nn") || lang.startsWith("no")) return "nb";
  }
  return "en";
}

let currentLocale: Locale = detectInitialLocale();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }
  } catch {
    // localStorage may throw in some sandboxed contexts
  }
}

export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  const dict = messages[currentLocale] ?? messages.en;
  let str: string = dict[key] ?? messages.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}
