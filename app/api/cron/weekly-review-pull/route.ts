import { NextRequest, NextResponse } from "next/server";
import { getAllSnapshots, logRun } from "@/lib/airtable";
import { sendWeeklyDigest, sendFailureAlert } from "@/lib/email";
import { computeChanges, latestBefore, summarise } from "@/lib/changes";
import { pullAndStore, yesterdayLondon } from "@/lib/pull";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Scheduling: vercel.json fires this once, every Monday at 06:00 UTC. On Vercel's Hobby plan
// a cron can only run once a day and may fire anywhere within that hour (06:00-06:59 UTC),
// i.e. roughly 06:00-07:59 UK time depending on GMT/BST. Because it runs only once, there is
// no UK-hour check: whenever the scheduled call arrives, it does the work.
// The monthly update is a separate job (/api/cron/monthly-review-update, 1st of the month).

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const weekEnding = yesterdayLondon();
  let placeIdsResolved = 0;

  try {
    // Read history BEFORE writing this week's rows, so "previous" really means previous.
    const history = await getAllSnapshots();
    const result = await pullAndStore(weekEnding, history, { write: true });
    placeIdsResolved = result.placeIdsResolved;

    const changes = computeChanges(result.current, latestBefore(history, weekEnding));
    await sendWeeklyDigest(changes, summarise(changes), weekEnding);

    const notChecked = result.current.filter((r) => r.rating === null).length;
    await logRun(
      "success",
      `Weekly pull: ${result.current.length} showrooms (${notChecked} not checked), resolved ${placeIdsResolved} new Place IDs.`,
      placeIdsResolved
    );

    return NextResponse.json({
      ok: true,
      weekEnding,
      locationsChecked: result.current.length,
      notChecked,
      placeIdsResolved,
    });
  } catch (err) {
    const message = errorText(err);
    console.error("Weekly review pull failed:", message);

    // Don't let a failed alert/log call hide the original failure from Chris.
    try {
      await sendFailureAlert("weekly Google pull", message);
    } catch (alertErr) {
      console.error("Also failed to send the failure alert email:", alertErr);
    }
    try {
      await logRun("failed", `Weekly pull: ${message}`, placeIdsResolved);
    } catch (logErr) {
      console.error("Also failed to log the failed run to Airtable:", logErr);
    }
    return NextResponse.json({ ok: false, job: "weekly", error: message }, { status: 500 });
  }
}
