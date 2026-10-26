// Week-on-week and month-on-month change calculations. Pure functions, no network calls.
//
// Everything here works from the snapshots already stored in Airtable's "Weekly Snapshots"
// table. A snapshot is keyed by showroom name + "Week Ending" (a Sunday, ISO date string).

export type Snapshot = {
  location: string;
  weekEnding: string; // ISO date, e.g. "2026-10-25"
  rating: number | null;
  reviewCount: number | null;
};

export type CurrentRow = {
  location: string;
  rating: number | null;
  reviewCount: number | null;
};

export type Change = {
  location: string;
  rating: number | null;
  reviewCount: number | null;
  previousRating: number | null;
  previousReviewCount: number | null;
  previousDate: string | null; // week ending of the snapshot compared against
  ratingChange: number | null; // 1 decimal place
  newReviews: number | null; // change in total review count
};

export type Summary = {
  totalReviews: number;
  totalNewReviews: number | null; // null when nothing could be compared
  blendedRating: number | null; // review-count-weighted, like-for-like showrooms only
  blendedChange: number | null;
  showroomsCompared: number;
  showroomsNotCompared: number;
  baselineDates: string[]; // distinct baseline dates used, oldest first
};

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function weeksBetween(fromIso: string, toIso: string): number {
  const ms = new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime();
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

export type BaselinePicker = (location: string) => Snapshot | null;

// Snapshots we can safely compare against: earlier than now, and with a real review count.
// A snapshot that was "not checked" (null) is never used as a baseline.
function usableHistory(history: Snapshot[], location: string, currentWeekEnding: string): Snapshot[] {
  return history
    .filter((s) => s.location === location && s.reviewCount !== null && s.weekEnding < currentWeekEnding)
    .sort((a, b) => b.weekEnding.localeCompare(a.weekEnding)); // newest first
}

/**
 * Month-on-month: compare against the snapshot at (or just before) the same point last month.
 * If a showroom has nothing that old, fall back to its earliest snapshot on record so the
 * digest still says something, and the baseline date shown makes the shorter period obvious.
 */
export function monthlyBaseline(
  history: Snapshot[],
  currentWeekEnding: string,
  targetWeekEnding: string
): BaselinePicker {
  return (location) => {
    const candidates = usableHistory(history, location, currentWeekEnding);
    return (
      candidates.find((s) => s.weekEnding <= targetWeekEnding) ?? candidates[candidates.length - 1] ?? null
    );
  };
}

/**
 * The monthly update goes out on the 1st and covers the calendar month that just ended.
 * Given this run's snapshot date (the last day of that month), returns the previous
 * month-end to compare against, e.g. "2026-10-31" -> "2026-09-30".
 */
export function monthlyTargetWeekEnding(currentSnapshotDate: string): string {
  const firstOfThisMonth = `${currentSnapshotDate.slice(0, 7)}-01`;
  return addDays(firstOfThisMonth, -1);
}

/** Week-on-week: the snapshot at, or just before, seven days earlier (falls back to the oldest available). */
export function latestBefore(history: Snapshot[], currentWeekEnding: string): BaselinePicker {
  return monthlyBaseline(history, currentWeekEnding, addDays(currentWeekEnding, -7));
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export function computeChanges(current: CurrentRow[], pick: BaselinePicker): Change[] {
  return current.map((row) => {
    const base = pick(row.location);
    return {
      location: row.location,
      rating: row.rating,
      reviewCount: row.reviewCount,
      previousRating: base?.rating ?? null,
      previousReviewCount: base?.reviewCount ?? null,
      previousDate: base?.weekEnding ?? null,
      ratingChange:
        row.rating !== null && base?.rating != null ? round(row.rating - base.rating, 1) : null,
      newReviews:
        row.reviewCount !== null && base?.reviewCount != null ? row.reviewCount - base.reviewCount : null,
    };
  });
}

export function summarise(changes: Change[]): Summary {
  const totalReviews = changes.reduce((sum, c) => sum + (c.reviewCount ?? 0), 0);

  const withNew = changes.filter((c) => c.newReviews !== null);
  const totalNewReviews = withNew.length > 0 ? withNew.reduce((sum, c) => sum + (c.newReviews ?? 0), 0) : null;

  // Like-for-like blended rating: only showrooms with a rating and review count both now and before.
  const comparable = changes.filter(
    (c) =>
      c.rating !== null &&
      c.reviewCount !== null &&
      c.previousRating !== null &&
      c.previousReviewCount !== null
  );
  let blendedRating: number | null = null;
  let blendedChange: number | null = null;
  if (comparable.length > 0) {
    const nowWeight = comparable.reduce((s, c) => s + (c.reviewCount as number), 0);
    const prevWeight = comparable.reduce((s, c) => s + (c.previousReviewCount as number), 0);
    if (nowWeight > 0 && prevWeight > 0) {
      const now = comparable.reduce((s, c) => s + (c.rating as number) * (c.reviewCount as number), 0) / nowWeight;
      const prev =
        comparable.reduce((s, c) => s + (c.previousRating as number) * (c.previousReviewCount as number), 0) /
        prevWeight;
      blendedRating = round(now, 2);
      blendedChange = round(now - prev, 2);
    }
  }

  const baselineDates = Array.from(
    new Set(changes.map((c) => c.previousDate).filter((d): d is string => d !== null))
  ).sort();

  return {
    totalReviews,
    totalNewReviews,
    blendedRating,
    blendedChange,
    showroomsCompared: withNew.length,
    showroomsNotCompared: changes.length - withNew.length,
    baselineDates,
  };
}

/** The most recent week's rows, one per showroom (used by the status page). */
export function latestWeek(history: Snapshot[]): { weekEnding: string; rows: CurrentRow[] } | null {
  if (history.length === 0) return null;
  const weekEnding = history.reduce((max, s) => (s.weekEnding > max ? s.weekEnding : max), history[0].weekEnding);
  const byLocation = new Map<string, CurrentRow>();
  for (const s of history) {
    if (s.weekEnding === weekEnding) {
      byLocation.set(s.location, { location: s.location, rating: s.rating, reviewCount: s.reviewCount });
    }
  }
  return { weekEnding, rows: Array.from(byLocation.values()) };
}
