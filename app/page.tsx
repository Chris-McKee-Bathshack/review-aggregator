import { getLatestRun, getLatestSnapshots } from "@/lib/airtable";

export const dynamic = "force-dynamic";

function formatRunTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an unknown time";
  return date.toLocaleString("en-GB", { timeZone: "Europe/London" });
}

export default async function StatusPage() {
  const [run, snapshots] = await Promise.all([getLatestRun(), getLatestSnapshots()]);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 20 }}>Review Aggregator — Google Reviews</h1>

      {/* Only say "succeeded" when the run record literally says so — anything else is not a pass. */}
      {!run && <p>No runs recorded yet.</p>}
      {run?.status === "success" && (
        <p style={{ color: "#15803d" }}>Last run succeeded at {formatRunTime(run.runAt)}.</p>
      )}
      {run?.status === "failed" && (
        <p style={{ color: "#b91c1c" }}>
          Last run failed at {formatRunTime(run.runAt)} — figures below are from an earlier run.
        </p>
      )}
      {run && run.status !== "success" && run.status !== "failed" && (
        <p style={{ color: "#a16207" }}>
          Last run has an unrecognised status ("{run.status}") at {formatRunTime(run.runAt)}.
        </p>
      )}

      {snapshots.length > 0 ? (
        <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 16 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "6px 12px 6px 0" }}>Showroom</th>
              <th style={{ padding: "6px 12px" }}>Rating</th>
              <th style={{ padding: "6px" }}>Reviews</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((row) => (
              <tr key={row.location} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "6px 12px 6px 0" }}>{row.location}</td>
                <td style={{ padding: "6px 12px" }}>{row.rating ?? "not checked"}</td>
                <td style={{ padding: "6px" }}>{row.reviewCount ?? "not checked"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ marginTop: 16 }}>No showroom figures recorded yet.</p>
      )}

      <p style={{ marginTop: 24, color: "#666", fontSize: 14 }}>
        Full history lives in the Airtable base. The weekly digest email is the primary output —
        this page is just a quick freshness check.
      </p>
    </main>
  );
}
