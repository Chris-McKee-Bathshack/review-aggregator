import { Resend } from "resend";
import ExcelJS from "exceljs";

export type DigestRow = {
  location: string;
  rating: number | null;
  reviewCount: number | null;
};

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

async function buildWorkbookBuffer(rows: DigestRow[], weekEnding: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Google Reviews");

  sheet.columns = [
    { header: "Showroom", key: "location", width: 28 },
    { header: "Rating", key: "rating", width: 12 },
    { header: "Review Count", key: "reviewCount", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow({
      location: row.location,
      rating: row.rating ?? "not checked",
      reviewCount: row.reviewCount ?? "not checked",
    });
  }

  sheet.addRow({});
  sheet.addRow({ location: `Week ending ${weekEnding}` });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function buildHtmlSummary(rows: DigestRow[], weekEnding: string): string {
  const lines = rows
    .map((row) => {
      const rating = row.rating !== null ? row.rating.toFixed(1) : "not checked";
      const count = row.reviewCount !== null ? row.reviewCount.toString() : "not checked";
      return `<tr><td style="padding:4px 12px 4px 0">${row.location}</td><td style="padding:4px 12px">${rating}</td><td style="padding:4px">${count}</td></tr>`;
    })
    .join("\n");

  const anyNotChecked = rows.some((r) => r.rating === null || r.reviewCount === null);

  return `
    <p>Google Reviews — week ending ${weekEnding}</p>
    <table style="border-collapse:collapse">
      <tr style="font-weight:bold"><td style="padding:4px 12px 4px 0">Showroom</td><td style="padding:4px 12px">Rating</td><td style="padding:4px">Reviews</td></tr>
      ${lines}
    </table>
    ${anyNotChecked ? "<p>One or more showrooms couldn't be checked this week — see \"not checked\" rows above rather than treating them as zero.</p>" : ""}
    <p>Full table attached as a spreadsheet.</p>
  `;
}

export async function sendWeeklyDigest(rows: DigestRow[], weekEnding: string): Promise<void> {
  const buffer = await buildWorkbookBuffer(rows, weekEnding);

  await resendClient().emails.send({
    from: fromAddress(),
    to: toAddress(),
    subject: `Google Reviews weekly digest — week ending ${weekEnding}`,
    html: buildHtmlSummary(rows, weekEnding),
    attachments: [
      {
        filename: `google-reviews-${weekEnding}.xlsx`,
        content: buffer,
      },
    ],
  });
}

export async function sendFailureAlert(message: string): Promise<void> {
  await resendClient().emails.send({
    from: fromAddress(),
    to: toAddress(),
    subject: "Review Aggregator — weekly Google pull failed",
    html: `<p>The weekly Google Reviews pull failed and did not complete.</p><pre>${message
      .slice(0, 4000)
      .replace(/</g, "&lt;")}</pre><p>Last week's figures are the most recent you have until this is fixed and re-run.</p>`,
  });
}
