import { NextRequest, NextResponse } from "next/server";
import {
  listActiveLocations,
  updateLocationPlaceId,
  createWeeklySnapshots,
  logRun,
} from "@/lib/airtable";
import { resolvePlaceId, getPlaceRating } from "@/lib/places";
import { sendWeeklyDigest, sendFailureAlert, type DigestRow } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Scheduling: vercel.json fires this once, every Monday at 06:00 UTC. On Vercel's Hobby plan
// a cron can only run once a day and may fire anywhere within that hour (06:00-06:59 UTC),
// i.e. roughly 06:00-07:59 UK time depending on GMT/BST. Because it runs only once, there is
// no UK-hour check: whenever the scheduled call arrives, it does the work.
// (If you move to the Pro plan, you can switch to the double-trigger + London-hour check
// pattern for exact UK-time scheduling.)

// The cron covers the 7 days up to and including yesterday (Sunday, when this runs Monday).
function weekEndingDate(): string {
  const now = new Date();
  const londonNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  londonNow.setDate(londonNow.getDate() - 1);
  return londonNow.toISOString().slice(0, 10);
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let locationsResolvedThisRun = 0;

  try {
    const locations = await listActiveLocations();

    // Resolve any Place IDs we haven't cached yet (first run, or a newly added showroom).
    for (const loc of locations) {
      if (!loc.placeId) {
        const resolved = await resolvePlaceId(loc.name, loc.town);
        if (resolved) {
          await updateLocationPlaceId(loc.id, resolved);
          loc.placeId = resolved;
          locationsResolvedThisRun += 1;
        }
      }
    }

    const weekEnding = weekEndingDate();
    const digestRows: DigestRow[] = [];
    const snapshotRows: {
      weekEnding: string;
      location: string;
      placeId: string;
      rating: number | null;
      reviewCount: number | null;
    }[] = [];

    for (const loc of locations) {
      if (!loc.placeId) {
        // Couldn't resolve a Place ID even after trying above — surface as "not checked", not zero.
        digestRows.push({ location: loc.name, rating: null, reviewCount: null });
        continue;
      }

      const rating = await getPlaceRating(loc.placeId);
      digestRows.push({
        location: loc.name,
        rating: rating?.rating ?? null,
        reviewCount: rating?.reviewCount ?? null,
      });
      snapshotRows.push({
        weekEnding,
        location: loc.name,
        placeId: loc.placeId,
        rating: rating?.rating ?? null,
        reviewCount: rating?.reviewCount ?? null,
      });
    }

    if (snapshotRows.length > 0) {
      await createWeeklySnapshots(snapshotRows);
    }

    await sendWeeklyDigest(digestRows, weekEnding);

    const notCheckedCount = digestRows.filter((r) => r.rating === null).length;
    await logRun(
      "success",
      `Pulled ${digestRows.length} showrooms (${notCheckedCount} not checked), resolved ${locationsResolvedThisRun} new Place IDs.`,
      locationsResolvedThisRun
    );

    return NextResponse.json({
      ok: true,
      weekEnding,
      locationsChecked: digestRows.length,
      notChecked: notCheckedCount,
      placeIdsResolved: locationsResolvedThisRun,
    });
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    console.error("Weekly review pull failed:", message);

    // Don't let a failed digest/log call hide the original failure from Chris.
    try {
      await sendFailureAlert(message);
    } catch (alertErr) {
      console.error("Also failed to send the failure alert email:", alertErr);
    }
    try {
      await logRun("failed", message, locationsResolvedThisRun);
    } catch (logErr) {
      console.error("Also failed to log the failed run to Airtable:", logErr);
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
