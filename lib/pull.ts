// Shared by the weekly and monthly jobs: pull live figures for every active showroom and
// store a snapshot row for each (unless one already exists for that showroom and date).

import { listActiveLocations, updateLocationPlaceId, createWeeklySnapshots } from "./airtable";
import { resolvePlaceId, getPlaceRating } from "./places";
import type { CurrentRow, Snapshot } from "./changes";

/** Yesterday's date in London, as an ISO date. Both jobs run in the morning, so this is the day just finished. */
export function yesterdayLondon(): string {
  const now = new Date();
  const londonNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  londonNow.setDate(londonNow.getDate() - 1);
  return londonNow.toISOString().slice(0, 10);
}

export type PullResult = { current: CurrentRow[]; placeIdsResolved: number; rowsWritten: number };

export async function pullAndStore(
  snapshotDate: string,
  history: Snapshot[],
  options: { write: boolean }
): Promise<PullResult> {
  const locations = await listActiveLocations();
  let placeIdsResolved = 0;

  // Resolve any Place IDs we haven't cached yet (first run, or a newly added showroom).
  for (const loc of locations) {
    if (!loc.placeId) {
      const resolved = await resolvePlaceId(loc.name, loc.town);
      if (resolved) {
        await updateLocationPlaceId(loc.id, resolved);
        loc.placeId = resolved;
        placeIdsResolved += 1;
      }
    }
  }

  const current: CurrentRow[] = [];
  const toWrite: { weekEnding: string; location: string; placeId: string; rating: number | null; reviewCount: number | null }[] = [];

  for (const loc of locations) {
    if (!loc.placeId) {
      // Couldn't resolve a Place ID — surface as "not checked", never as zero.
      current.push({ location: loc.name, rating: null, reviewCount: null });
      continue;
    }
    const rating = await getPlaceRating(loc.placeId);
    const row = { location: loc.name, rating: rating?.rating ?? null, reviewCount: rating?.reviewCount ?? null };
    current.push(row);

    // If the other job already stored a real snapshot for this showroom and date, don't store a second one.
    const alreadyStored = history.some(
      (s) => s.location === loc.name && s.weekEnding === snapshotDate && s.reviewCount !== null
    );
    if (!alreadyStored) toWrite.push({ weekEnding: snapshotDate, placeId: loc.placeId, ...row });
  }

  if (options.write && toWrite.length > 0) await createWeeklySnapshots(toWrite);
  return { current, placeIdsResolved, rowsWritten: options.write ? toWrite.length : 0 };
}
