/**
 * The one definition of the Simple Kitchen ordering week, shared by the
 * admin pages and the server.
 *
 *   Web orders open   Saturday 12:00 (UK time)
 *   Web orders close  Wednesday 23:59:59 (UK time)
 *   Shop closed       Thursday 00:00 → Saturday 11:59
 *
 * A week's window runs from its Saturday noon right up to the next Saturday
 * noon, so nothing placed while the shop is closed (late staff orders,
 * stamps) can ever fall between two weeks and go missing. Its Saturday and
 * Tuesday deliveries are the following Saturday and Tuesday.
 *
 * Subscription invite timing has its own rules in server/routes.ts and does
 * not use this file.
 */

const TZ = "Europe/London";
export const WEEK_OPENS_HOUR = 12;

type YMD = { y: number; m: number; d: number };
type LondonParts = YMD & { weekday: number; hour: number; minute: number; second: number };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function londonParts(date: Date): LondonParts {
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return {
    y: Number(get("year")), m: Number(get("month")), d: Number(get("day")),
    weekday: WEEKDAYS[get("weekday")] ?? date.getUTCDay(),
    hour: Number(get("hour")) % 24, minute: Number(get("minute")), second: Number(get("second")),
  };
}

/** The instant at which UK clocks show the given wall-clock time. */
export function londonTime(y: number, m: number, d: number, hour = 0, minute = 0, second = 0, ms = 0): Date {
  const wanted = Date.UTC(y, m - 1, d, hour, minute, second, ms);
  let t = wanted;
  for (let i = 0; i < 3; i++) {
    const p = londonParts(new Date(t));
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second, ms);
    if (shown === wanted) break;
    t += wanted - shown;
  }
  return new Date(t);
}

const addDays = ({ y, m, d }: YMD, days: number): YMD => {
  const x = new Date(Date.UTC(y, m - 1, d + days));
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
};
const keyOf = ({ y, m, d }: YMD) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export type OperationalWeek = {
  /** UK calendar date of the opening Saturday, e.g. "2026-11-21". */
  key: string;
  /** Saturday 12:00 UK time. */
  from: Date;
  /** Wednesday 23:59:59.999 UK time: last moment web orders are taken. */
  ordersClose: Date;
  /** Just before the next Saturday 12:00 UK time. */
  to: Date;
};

function weekStarting(sat: YMD): OperationalWeek {
  const wed = addDays(sat, 4);
  const next = addDays(sat, 7);
  return {
    key: keyOf(sat),
    from: londonTime(sat.y, sat.m, sat.d, WEEK_OPENS_HOUR),
    ordersClose: londonTime(wed.y, wed.m, wed.d, 23, 59, 59, 999),
    to: new Date(londonTime(next.y, next.m, next.d, WEEK_OPENS_HOUR).getTime() - 1),
  };
}

function openingSaturday(date: Date): YMD {
  const p = londonParts(date);
  const back = p.weekday === 6 ? (p.hour < WEEK_OPENS_HOUR ? 7 : 0) : p.weekday + 1;
  return addDays(p, -back);
}

/** The week a moment in time belongs to. */
export function operationalWeekOf(date: Date): OperationalWeek {
  return weekStarting(openingSaturday(date));
}

/** This week (offset 0), last week (-1), next week (1)… */
export function operationalWeek(offset = 0, now: Date = new Date()): OperationalWeek {
  return weekStarting(addDays(openingSaturday(now), offset * 7));
}

/** Look a week up by its Saturday key ("YYYY-MM-DD"). Null if it isn't a Saturday. */
export function operationalWeekByKey(key: unknown): OperationalWeek | null {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCDay() !== 6 || keyOf({ y: check.getUTCFullYear(), m: check.getUTCMonth() + 1, d: check.getUTCDate() }) !== key) return null;
  return weekStarting({ y, m, d });
}

/**
 * The order date for something staff add to a week (stamps, manual orders):
 * "now" while that week is open for orders, otherwise its opening Saturday noon.
 */
export function staffOrderDate(week: OperationalWeek, now: Date = new Date()): Date {
  return now >= week.from && now <= week.ordersClose ? now : new Date(week.from);
}
