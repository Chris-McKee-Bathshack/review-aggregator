export const metadata = {
  title: "Review Aggregator",
  description: "Internal Bathshack tool — scheduled review-platform pulls and digests.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
