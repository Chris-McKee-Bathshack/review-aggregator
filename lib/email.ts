import { Resend } from "resend";
import ExcelJS from "exceljs";
import { daysBetween, formatDate, type Change, type Summary } from "./changes";

function resendClient(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return new Resend(key);
}

function fromAddress(): string {
  return process.env.DIGEST_FROM_EMAIL ?? "reviews@email.bathshapp.com";
}

function toAddress(): string {
  return process.env.DIGEST_TO_EMAIL ?? "chris.mckee@bathshack.com";
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------- formatting helpers ----------

const GREEN = "#15803d";
const RED = "#b91c1c";

function ratingText(n: number | null): string {
  return n === null ? "not checked" : n.toFixed(1);
}

function countText(n: number | null): string {
  return n === null ? "not checked" : n.toLocaleString("en-GB");
}

function signed(n: number, decimals: number): string {
  if (n === 0) return "no change";
  const text = Math.abs(n).toFixed(decimals);
  return n > 0 ? `+${text}` : `-${text}`;
}

// null here means "no previous snapshot / not checked", which is not the same as "no change".
function ratingChangeText(n: number | null): string {
  return n === null ? "n/a" : signed(n, 1);
}

function newReviewsText(n: number | null): string {
  return n === null ? "n/a" : n === 0 ? "0" : n > 0 ? `+${n}` : `${n}`;
}

function colour(n: number | null): string {
  if (n === null || n === 0) return "inherit";
  return n > 0 ? GREEN : RED;
}

function comparisonText(summary: Summary, kind: "week" | "month"): string {
  if (summary.baselineDates.length === 0) {
    return kind === "week"
      ? "No previous snapshot yet, so changes will appear from next week."
      : "No earlier snapshots to compare with yet.";
  }
  if (summary.baselineDates.length === 1) {
    return `Compared with the snapshot from ${formatDate(summary.baselineDates[0])}.`;
  }
  return "Compared with each showroom's earlier snapshot (the dates are in the spreadsheet).";
}

// ---------- shared table + workbook ----------

function renderTable(changes: Change[], newLabel: string): string {
  const rows = changes
    .map(
      (c) => `<tr>
        <td style="padding:4px 16px 4px 0">${escapeHtml(c.location)}</td>
        <td style="padding:4px 12px">${ratingText(c.rating)}</td>
        <td style="padding:4px 12px;color:${colour(c.ratingChange)}">${ratingChangeText(c.ratingChange)}</td>
        <td style="padding:4px 12px">${countText(c.reviewCount)}</td>
        <td style="padding:4px 0 4px 12px;color:${colour(c.newReviews)}">${newReviewsText(c.newReviews)}</td>
      </tr>`
    )
    .join("\n");

  return `<table style="border-collapse:collapse">
    <tr style="font-weight:bold;text-align:left">
      <td style="padding:4px 16px 4px 0">Showroom</td>
      <td style="padding:4px 12px">Rating</td>
      <td style="padding:4px 12px">Change</td>
      <td style="padding:4px 12px">Reviews</td>
      <td style="padding:4px 0 4px 12px">${newLabel}</td>
    </tr>
    ${rows}
  </table>`;
}

function renderSummary(summary: Summary, newLabel: string): string {
  if (summary.showroomsCompared === 0 && summary.totalReviews === 0) {
    return `<p><strong>All showrooms:</strong> no figures available this time.</p>`;
  }
  const lines: string[] = [`<strong>All showrooms:</strong> ${summary.totalReviews.toLocaleString("en-GB")} reviews in total`];
  if (summary.totalNewReviews !== null) {
    lines[0] += `, ${newLabel.toLowerCase()} ${newReviewsText(summary.totalNewReviews)}`;
  }
  if (summary.blendedRating !== null) {
    const change = summary.blendedChange !== null ? ` (${signed(summary.blendedChange, 2)})` : "";
    lines.push(
      `Blended rating ${summary.blendedRating.toFixed(2)}${change} — weighted by review count, showrooms with a previous snapshot only.`
    );
  }
  return `<p>${lines.join("<br>")}</p>`;
}

function notCheckedNote(changes: Change[], problems: string[] = []): string {
  if (!changes.some((c) => c.rating === null || c.reviewCount === null) && problems.length === 0) return "";
  const reasons =
    problems.length > 0
      ? `<p>What went wrong:</p><ul>${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`
      : "";
  return `<p>One or more showrooms couldn't be checked, so they show "not checked" rather than a figure. Please don't read that as zero.</p>${reasons}`;
}

async function buildWorkbook(
  changes: Change[],
  sheetName: string,
  newLabel: string,
  footer: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = [
    { header: "Showroom", key: "location", width: 28 },
    { header: "Rating", key: "rating", width: 12 },
    { header: "Rating change", key: "ratingChange", width: 16 },
    { header: "Review count", key: "reviewCount", width: 16 },
    { header: newLabel, key: "newReviews", width: 18 },
    { header: "Previous rating", key: "previousRating", width: 16 },
    { header: "Previous review count", key: "previousReviewCount", width: 22 },
    { header: "Compared with (snapshot date)", key: "previousDate", width: 26 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const c of changes) {
    sheet.addRow({
      location: c.location,
      rating: c.rating ?? "not checked",
      ratingChange: c.ratingChange ?? "n/a",
      reviewCount: c.reviewCount ?? "not checked",
      newReviews: c.newReviews ?? "n/a",
      previousRating: c.previousRating ?? "n/a",
      previousReviewCount: c.previousReviewCount ?? "n/a",
      previousDate: c.previousDate ?? "n/a",
    });
  }

  sheet.addRow({});
  sheet.addRow({ location: footer });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ---------- weekly digest ----------

export async function sendWeeklyDigest(
  changes: Change[],
  summary: Summary,
  weekEnding: string,
  problems: string[] = []
): Promise<void> {
  const newLabel = "New this week";
  const buffer = await buildWorkbook(changes, "Google Reviews", newLabel, `Week ending ${weekEnding}`);

  const html = `
    <p><strong>Google Reviews — week ending ${formatDate(weekEnding)}</strong><br>${comparisonText(summary, "week")}</p>
    ${renderSummary(summary, newLabel)}
    ${renderTable(changes, newLabel)}
    ${notCheckedNote(changes, problems)}
    <p>Full table attached as a spreadsheet. Ratings are rounded to one decimal place by Google, so small movements in a showroom's score may not show until they cross a rounding point; the review count is exact.</p>
  `;

  await resendClient().emails.send({
    from: fromAddress(),
    to: toAddress(),
    subject: `Google Reviews weekly digest — week ending ${formatDate(weekEnding)}`,
    html,
    attachments: [{ filename: `google-reviews-${weekEnding}.xlsx`, content: buffer }],
  });
}

// ---------- monthly digest ----------

function highlights(changes: Change[]): string {
  const parts: string[] = [];

  const byNew = changes
    .filter((c) => c.newReviews !== null && c.newReviews > 0)
    .sort((a, b) => (b.newReviews as number) - (a.newReviews as number))
    .slice(0, 3);
  if (byNew.length > 0) {
    parts.push(
      `Most new reviews: ${byNew.map((c) => `${escapeHtml(c.location)} (${newReviewsText(c.newReviews)})`).join(", ")}`
    );
  }

  const up = changes.filter((c) => c.ratingChange !== null && c.ratingChange >= 0.1);
  const down = changes.filter((c) => c.ratingChange !== null && c.ratingChange <= -0.1);
  if (up.length > 0) {
    parts.push(
      `Rating up: ${up.map((c) => `${escapeHtml(c.location)} (${signed(c.ratingChange as number, 1)})`).join(", ")}`
    );
  }
  if (down.length > 0) {
    parts.push(
      `Rating down: ${down.map((c) => `${escapeHtml(c.location)} (${signed(c.ratingChange as number, 1)})`).join(", ")}`
    );
  }
  if (parts.length === 0) return "";
  return `<p>${parts.join("<br>")}</p>`;
}

export async function sendMonthlyDigest(
  changes: Change[],
  summary: Summary,
  weekEnding: string,
  problems: string[] = []
): Promise<void> {
  const newLabel = "New this period";
  const earliest = summary.baselineDates[0];
  const periodDays = earliest ? daysBetween(earliest, weekEnding) : null;

  const periodText = earliest
    ? `${formatDate(earliest)} to ${formatDate(weekEnding)}${periodDays ? ` (${periodDays} days)` : ""}`
    : `Position at ${formatDate(weekEnding)}`;

  const perWeek =
    summary.totalNewReviews !== null && periodDays && periodDays > 0
      ? `<p>That is about ${((summary.totalNewReviews / periodDays) * 7).toFixed(1)} new reviews a week across all showrooms.</p>`
      : "";

  const buffer = await buildWorkbook(changes, "Monthly update", newLabel, periodText);

  const html = `
    <p><strong>Google Reviews — monthly update</strong><br>${periodText}<br>${comparisonText(summary, "month")}</p>
    ${renderSummary(summary, newLabel)}
    ${perWeek}
    ${highlights(changes)}
    ${renderTable(changes, newLabel)}
    ${notCheckedNote(changes, problems)}
    <p>This compares the figures pulled this morning (stored as the month-end snapshot) with the previous month-end snapshot. Where an earlier month-end isn't on record yet, it uses the closest earlier snapshot and says so above. Full table attached as a spreadsheet.</p>
  `;

  await resendClient().emails.send({
    from: fromAddress(),
    to: toAddress(),
    subject: `Google Reviews monthly update — ${new Date(`${weekEnding}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`,
    html,
    attachments: [{ filename: `google-reviews-monthly-${weekEnding}.xlsx`, content: buffer }],
  });
}

// ---------- failure alert ----------

export async function sendFailureAlert(job: string, message: string): Promise<void> {
  await resendClient().emails.send({
    from: fromAddress(),
    to: toAddress(),
    subject: `Review Aggregator — ${job} failed`,
    html: `<p>The ${escapeHtml(job)} failed and did not complete.</p><pre>${escapeHtml(
      message.slice(0, 4000)
    )}</pre><p>The most recent figures you have are from the last successful run until this is fixed and re-run.</p>`,
  });
}
