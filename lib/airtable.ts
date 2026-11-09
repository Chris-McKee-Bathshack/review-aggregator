// Minimal Airtable REST client — no SDK dependency, just fetch.
// Base schema this expects (create these tables manually in the Airtable base first):
//
// Table "Locations"
//   - Name (single line text)      e.g. "Bathshack Ballymena"
//   - Town (single line text)      e.g. "Ballymena"            (used to disambiguate the Places search)
//   - Place ID (single line text)  left blank initially — the job resolves and caches it here
//   - Active (checkbox)            default checked
//
// Table "Weekly Snapshots"
//   - Week Ending (date)
//   - Location (single line text)
//   - Place ID (single line text)
//   - Rating (number)
//   - Review Count (number)
//   - Pulled At (date)
//
// Table "Runs"
//   - Run At (date)
//   - Status (single line text)     "success" | "failed"
//   - Message (long text)
//   - Locations Updated (number)

import type { Snapshot } from "./changes";

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

function airtableHeaders() {
  const token = process.env.AIRTABLE_PAT_REVIEW_AGGREGATOR;
  if (!token) throw new Error("AIRTABLE_PAT_REVIEW_AGGREGATOR is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function baseUrl(table: string) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!baseId) throw new Error("AIRTABLE_BASE_ID is not set");
  return `${AIRTABLE_API_BASE}/${baseId}/${encodeURIComponent(table)}`;
}

export type LocationRecord = {
  id: string;
  name: string;
  town: string;
  placeId: string | null;
};

export async function listActiveLocations(): Promise<LocationRecord[]> {
  const records: LocationRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(baseUrl("Locations"));
    url.searchParams.set("filterByFormula", "{Active} = 1");
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), { headers: airtableHeaders() });
    if (!res.ok) {
      throw new Error(`Airtable list Locations failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      records: { id: string; fields: Record<string, any> }[];
      offset?: string;
    };

    for (const r of data.records) {
      records.push({
        id: r.id,
        name: r.fields["Name"] ?? "",
        town: r.fields["Town"] ?? "",
        placeId: r.fields["Place ID"] ?? null,
      });
    }
    offset = data.offset;
  } while (offset);

  return records;
}

export async function updateLocationPlaceId(recordId: string, placeId: string): Promise<void> {
  const res = await fetch(baseUrl("Locations"), {
    method: "PATCH",
    headers: airtableHeaders(),
    body: JSON.stringify({
      records: [{ id: recordId, fields: { "Place ID": placeId } }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Airtable update Location ${recordId} failed: ${res.status} ${await res.text()}`);
  }
}

export type WeeklySnapshotRow = {
  weekEnding: string; // ISO date, e.g. "2026-10-19"
  location: string;
  placeId: string;
  rating: number | null;
  reviewCount: number | null;
};

export async function createWeeklySnapshots(rows: WeeklySnapshotRow[]): Promise<void> {
  const pulledAt = new Date().toISOString();

  // Airtable's create endpoint accepts at most 10 records per call.
  for (let i = 0; i < rows.length; i += 10) {
    const chunk = rows.slice(i, i + 10);
    const res = await fetch(baseUrl("Weekly Snapshots"), {
      method: "POST",
      headers: airtableHeaders(),
      body: JSON.stringify({
        records: chunk.map((row) => ({
          fields: {
            "Week Ending": row.weekEnding,
            Location: row.location,
            "Place ID": row.placeId,
            Rating: row.rating,
            "Review Count": row.reviewCount,
            "Pulled At": pulledAt,
          },
        })),
      }),
    });
    if (!res.ok) {
      throw new Error(`Airtable create Weekly Snapshots failed: ${res.status} ${await res.text()}`);
    }
  }
}

export type RunRecord = {
  runAt: string;
  status: "success" | "failed" | string;
  message: string;
  locationsUpdated: number;
};

export async function getLatestRun(): Promise<RunRecord | null> {
  const url = new URL(baseUrl("Runs"));
  url.searchParams.set("sort[0][field]", "Run At");
  url.searchParams.set("sort[0][direction]", "desc");
  // Fetch a few rows, not one: new Airtable tables ship with blank placeholder rows,
  // and those must never be mistaken for a real run.
  url.searchParams.set("pageSize", "10");

  const res = await fetch(url.toString(), { headers: airtableHeaders() });
  if (!res.ok) {
    console.error(`Airtable getLatestRun failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as { records: { fields: Record<string, any> }[] };

  for (const record of data.records) {
    const runAt = record.fields["Run At"];
    const status = record.fields["Status"];
    if (!runAt || !status) continue; // blank row — not a recorded run

    return {
      runAt,
      status,
      message: record.fields["Message"] ?? "",
      locationsUpdated: record.fields["Locations Updated"] ?? 0,
    };
  }
  return null;
}

/** Every real snapshot row, for week-on-week / month-on-month comparisons. */
export async function getAllSnapshots(): Promise<Snapshot[]> {
  const snapshots: Snapshot[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(baseUrl("Weekly Snapshots"));
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), { headers: airtableHeaders() });
    if (!res.ok) {
      throw new Error(`Airtable list Weekly Snapshots failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      records: { fields: Record<string, any> }[];
      offset?: string;
    };

    for (const r of data.records) {
      const location = r.fields["Location"];
      const weekEnding = r.fields["Week Ending"];
      if (!location || !weekEnding) continue; // blank placeholder row, not a snapshot
      snapshots.push({
        location,
        weekEnding,
        rating: typeof r.fields["Rating"] === "number" ? r.fields["Rating"] : null,
        reviewCount: typeof r.fields["Review Count"] === "number" ? r.fields["Review Count"] : null,
      });
    }
    offset = data.offset;
  } while (offset);

  return snapshots;
}

export async function logRun(
  status: "success" | "failed" | "partial",
  message: string,
  locationsUpdated: number
): Promise<void> {
  const res = await fetch(baseUrl("Runs"), {
    method: "POST",
    headers: airtableHeaders(),
    body: JSON.stringify({
      records: [
        {
          fields: {
            "Run At": new Date().toISOString(),
            Status: status,
            Message: message.slice(0, 9000),
            "Locations Updated": locationsUpdated,
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    // Don't let a logging failure mask the real error — just surface both.
    console.error(`Airtable logRun failed: ${res.status} ${await res.text()}`);
  }
}
