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

// UK clocks shift between GMT and BST, but Vercel cron schedules are fixed in UTC.
// vercel.json fires this at both 06:00 and 07:00 UTC every Monday; whichever of
// those is actually 06:00 in Europe/London does the work, the other is a no-op.
const INTENDED_LONDON_HOUR = 6;

function currentLondonHour(): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(formatter.format(new Date()), 10);
}

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

  // ?force=1 skips the UK-hour check so you can test on demand. It still needs the bearer secret above.
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && currentLondonHour() !== INTENDED_LONDON_HOUR) {
    return NextResponse.json({ skipped: true, reason: "not the intended UK hour" });
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
