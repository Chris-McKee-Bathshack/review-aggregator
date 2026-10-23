import { getLatestRun, getLatestSnapshots } from "@/lib/airtable";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const [run, snapshots] = await Promise.all([getLatestRun(), getLatestSnapshots()]);

  const runFailed = run?.status === "failed";

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 20 }}>Review Aggregator — Google Reviews</h1>

      {run ? (
        <p style={{ color: runFailed ? "#b91c1c" : "#15803d" }}>
          {runFailed
            ? `Last run failed at ${new Date(run.runAt).toLocaleString("en-GB")} — figures below are from an earlier run.`
            : `Last run succeeded at ${new Date(run.runAt).toLocaleString("en-GB")}.`}
        </p>
      ) : (
        <p>No runs recorded yet.</p>
      )}

      {snapshots.length > 0 && (
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
      )}

      <p style={{ marginTop: 24, color: "#666", fontSize: 14 }}>
        Full history lives in the Airtable base. The weekly digest email is the primary output —
        this page is just a quick freshness check.
      </p>
    </main>
  );
}
