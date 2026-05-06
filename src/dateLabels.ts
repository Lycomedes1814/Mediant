import { getLocale } from "./i18n.ts";

const DAY_ABBREVS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_ABBREVS_NB = ["søn", "man", "tir", "ons", "tor", "fre", "lør"] as const;

const DAY_NAMES_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const DAY_NAMES_NB = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"] as const;

const MONTH_ABBREVS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTH_ABBREVS_NB = ["jan.", "feb.", "mars", "apr.", "mai", "juni", "juli", "aug.", "sep.", "okt.", "nov.", "des."] as const;

const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const MONTH_NAMES_NB = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember",
] as const;

function pickByLocale<T>(en: T, nb: T): T {
  return getLocale() === "nb" ? nb : en;
}

export const DAY_ABBREVS = new Proxy([] as readonly string[], {
  get(_, prop) {
    return Reflect.get(pickByLocale(DAY_ABBREVS_EN, DAY_ABBREVS_NB), prop);
  },
});

export const DAY_NAMES = new Proxy([] as readonly string[], {
  get(_, prop) {
    return Reflect.get(pickByLocale(DAY_NAMES_EN, DAY_NAMES_NB), prop);
  },
});

export const MONTH_ABBREVS = new Proxy([] as readonly string[], {
  get(_, prop) {
    return Reflect.get(pickByLocale(MONTH_ABBREVS_EN, MONTH_ABBREVS_NB), prop);
  },
});

export const MONTH_NAMES = new Proxy([] as readonly string[], {
  get(_, prop) {
    return Reflect.get(pickByLocale(MONTH_NAMES_EN, MONTH_NAMES_NB), prop);
  },
});
