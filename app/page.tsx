import { getAllSnapshots, getLatestRun } from "@/lib/airtable";
import { computeChanges, formatDate, latestBefore, latestWeek } from "@/lib/changes";

export const dynamic = "force-dynamic";

function formatRunTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an unknown time";
  return date.toLocaleString("en-GB", { timeZone: "Europe/London" });
}

function signed(n: number, decimals: number): string {
  if (n === 0) return "no change";
  const text = Math.abs(n).toFixed(decimals);
  return n > 0 ? `+${text}` : `-${text}`;
}

export default async function StatusPage() {
  const [run, history] = await Promise.all([getLatestRun(), getAllSnapshots()]);

  const latest = latestWeek(history);
  const changes = latest ? computeChanges(latest.rows, latestBefore(history, latest.weekEnding)) : [];

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "40px auto", padding: "0 16px" }}>
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
      {run?.status === "partial" && (
        <p style={{ color: "#a16207" }}>
          Last run at {formatRunTime(run.runAt)} only partly worked — some showrooms were not checked.
        </p>
      )}
      {run && run.status !== "success" && run.status !== "failed" && run.status !== "partial" && (
        <p style={{ color: "#a16207" }}>
          Last run has an unrecognised status ("{run.status}") at {formatRunTime(run.runAt)}.
        </p>
      )}
      {run?.message && <p style={{ color: "#666", fontSize: 14, marginTop: -8 }}>{run.message.split("\n")[0]}</p>}

      {latest && changes.length > 0 ? (
        <>
          <p style={{ marginBottom: 4 }}>Latest snapshot: {formatDate(latest.weekEnding)}</p>
          <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: "6px 12px 6px 0" }}>Showroom</th>
                <th style={{ padding: "6px 12px" }}>Rating</th>
                <th style={{ padding: "6px 12px" }}>Change</th>
                <th style={{ padding: "6px 12px" }}>Reviews</th>
                <th style={{ padding: "6px" }}>New</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.location} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 12px 6px 0" }}>{c.location}</td>
                  <td style={{ padding: "6px 12px" }}>{c.rating ?? "not checked"}</td>
                  <td style={{ padding: "6px 12px" }}>{c.ratingChange === null ? "n/a" : signed(c.ratingChange, 1)}</td>
                  <td style={{ padding: "6px 12px" }}>{c.reviewCount ?? "not checked"}</td>
                  <td style={{ padding: "6px" }}>
                    {c.newReviews === null ? "n/a" : c.newReviews > 0 ? `+${c.newReviews}` : c.newReviews}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p style={{ marginTop: 16 }}>No showroom figures recorded yet.</p>
      )}

      <p style={{ marginTop: 24, color: "#666", fontSize: 14 }}>
        "Change" and "New" compare with each showroom's snapshot from about a week earlier. Full history lives in
        the Airtable base. The weekly and monthly digest emails are the primary output — this page is just a
        quick freshness check.
      </p>
    </main>
  );
}
