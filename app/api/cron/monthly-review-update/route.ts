import { NextRequest, NextResponse } from "next/server";
import { getAllSnapshots, logRun } from "@/lib/airtable";
import { sendMonthlyDigest, sendFailureAlert } from "@/lib/email";
import { computeChanges, monthlyBaseline, monthlyTargetWeekEnding, summarise } from "@/lib/changes";
import { pullAndStore, yesterdayLondon } from "@/lib/pull";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Scheduling: vercel.json fires this at 06:00 UTC on the 1st of every month (on Hobby it may
// fire any time in that hour). It pulls fresh figures, stores them as a snapshot dated the last
// day of the month just ended, and compares with the previous month-end snapshot.
//
// To test without storing anything, call it with ?preview=1 (sends the email, writes no snapshot).

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const preview = req.nextUrl.searchParams.get("preview") === "1";
  const snapshotDate = yesterdayLondon();

  try {
    // Read history BEFORE writing, so the comparison really is with an earlier snapshot.
    const history = await getAllSnapshots();
    const result = await pullAndStore(snapshotDate, history, { write: !preview });

    const target = monthlyTargetWeekEnding(snapshotDate);
    const changes = computeChanges(result.current, monthlyBaseline(history, snapshotDate, target));
    await sendMonthlyDigest(changes, summarise(changes), snapshotDate);

    const notChecked = result.current.filter((r) => r.rating === null).length;
    await logRun(
      "success",
      `Monthly update${preview ? " (preview, nothing stored)" : ""}: ${result.current.length} showrooms (${notChecked} not checked), snapshot ${snapshotDate}, compared with ${target} or earlier.`,
      result.placeIdsResolved
    );

    return NextResponse.json({
      ok: true,
      preview,
      snapshotDate,
      comparedWithOnOrBefore: target,
      locationsChecked: result.current.length,
      notChecked,
      rowsWritten: result.rowsWritten,
    });
  } catch (err) {
    const message = errorText(err);
    console.error("Monthly update failed:", message);
    try {
      await sendFailureAlert("monthly Google update", message);
    } catch (alertErr) {
      console.error("Also failed to send the failure alert email:", alertErr);
    }
    try {
      await logRun("failed", `Monthly update: ${message}`, 0);
    } catch (logErr) {
      console.error("Also failed to log the failed run to Airtable:", logErr);
    }
    return NextResponse.json({ ok: false, job: "monthly", error: message }, { status: 500 });
  }
}
