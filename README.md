# Review Aggregator — Google Reviews (v1)

Weekly, automated pull of each showroom's Google rating + review count, replacing the manual
monthly check. First engine in what will grow into a multi-platform review aggregator
(TrustPilot and reviews.io next). Headless — no login-gated UI beyond a one-page status check.

## What it does, every Monday morning (UK time)

1. Checks Airtable's `Locations` table for any showroom missing a cached Place ID, and resolves
   it via Google's Places API (one-time per showroom — after that, it's cached and skipped).
2. Pulls the current rating + review count for every active showroom.
3. Writes a snapshot row per showroom into Airtable's `Weekly Snapshots` table.
4. Emails you a digest (summary table + an attached spreadsheet) via Resend.
5. Logs the run (success/failure) to Airtable's `Runs` table, and emails a failure alert if
   anything went wrong — so a bad week never shows up as silence.

## 1. Set up Airtable

In your existing Airtable workspace, create a new base called **Review Aggregator** with these
three tables (exact names and field names matter — the code reads them literally):

**Locations**
| Field | Type |
|---|---|
| Name | Single line text |
| Town | Single line text |
| Place ID | Single line text |
| Active | Checkbox |

Add one row per showroom, filling in **Name** and **Town** only (leave **Place ID** blank — the
job fills it in on first run) and ticking **Active**. Your 13 showrooms:

Ballymena, Antrim, Dargan, Boucher, Lisburn, Lurgan, Armagh, Coleraine, Dublin, Galway, Cork,
Manchester, Tileshack at Huttons — Name as e.g. "Bathshack Ballymena", Town as e.g. "Ballymena"
(for Tileshack at Huttons, use whatever town it's actually in).

**Weekly Snapshots**
| Field | Type |
|---|---|
| Week Ending | Date |
| Location | Single line text |
| Place ID | Single line text |
| Rating | Number (1 decimal) |
| Review Count | Number (integer) |
| Pulled At | Date (include time) |

**Runs**
| Field | Type |
|---|---|
| Run At | Date (include time) |
| Status | Single line text |
| Message | Long text |
| Locations Updated | Number (integer) |

Then: Account → Developer hub → Personal access tokens → **Create new token**, name it
`review-aggregator`, scope it to **only** this base, with `data.records:read` and
`data.records:write` scopes (nothing broader). Copy the token and the base ID (from the base's
API docs page, starts `app...`) — you'll add both as Vercel env vars in step 4, not here.

## 2. Confirm the Resend from-address

This sends from `reviews@email.bathshapp.com` by default (the existing verified sending
domain). If you'd rather use a different local part, just change `DIGEST_FROM_EMAIL` when you
set env vars in step 4 — no code change needed.

## 3. Push to GitHub

1. Create a new empty repository on GitHub (no README/license — keep it empty).
2. Open **GitHub Desktop** → Clone that empty repo locally.
3. Unzip this project into the cloned folder (drag the contents in, not the zip itself).
4. Commit ("Initial commit — Google Reviews weekly pull") and push.

## 4. Deploy on Vercel

1. Import the GitHub repo as a new Vercel project (framework preset: Next.js, auto-detected).
2. Before the first deploy, add these Environment Variables (Project Settings → Environment
   Variables):

   | Variable | Value |
   |---|---|
   | `GOOGLE_PLACES_API_KEY` | the key from eComm, restricted to Places API (New) |
   | `AIRTABLE_PAT_REVIEW_AGGREGATOR` | the token from step 1 |
   | `AIRTABLE_BASE_ID` | the base ID from step 1 |
   | `RESEND_API_KEY` | your existing Resend API key |
   | `DIGEST_FROM_EMAIL` | `reviews@email.bathshapp.com` (or your preferred local part) |
   | `DIGEST_TO_EMAIL` | `chris.mckee@bathshack.com` |
   | `CRON_SECRET` | any long random string — e.g. run `openssl rand -hex 32` locally |
   | `BASIC_AUTH_USER` | a username for the status page |
   | `BASIC_AUTH_PASSWORD` | a password for the status page |

3. Deploy. Vercel reads `vercel.json` automatically and schedules the weekly cron — nothing
   else to configure there.

## 5. Test it before trusting the Monday run

The cron route normally only does its work at 6am UK time on Mondays. To run it on demand, add
`?force=1` and supply the bearer secret (on Windows, use `curl.exe` rather than `curl`):

```bash
curl -H "Authorization: Bearer <your CRON_SECRET>" "https://<your-vercel-url>/api/cron/weekly-review-pull?force=1"
```

A forced run is a real run: it writes snapshot rows to Airtable and sends the digest email. Once
you've checked the results, delete the test rows from `Weekly Snapshots` and `Runs` so the first
real Monday run doesn't sit alongside duplicates. Without `?force=1`, a call outside 6am UK time
returns `{"skipped":true,...}`, which is expected.

First real run will take slightly longer than later ones, since it's resolving all 13 Place IDs.
Worth eyeballing the resolved IDs in Airtable's Locations table afterwards — a generic name
occasionally matches the wrong nearby listing, and if one looks off, you can search it manually
via Google's [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id#find-id)
and paste the correct ID into that row yourself (it won't be re-resolved once a value is present).

## Before this goes live

Two more gates from the Bathshack build standards, once you're happy it's working:

- **Security review** — open a **new chat**, attach this repo's zip (confirm it has no
  `.env`/`.env.local` in it first), and ask for a review using the `bathshack-security-review`
  skill. Fix anything flagged Critical/High before relying on it.
- **Governance tracker entry** — once it has a live Vercel URL, this needs an entry in the
  Airtable API Key Governance tracker. Since you hold write access there, you can add it
  directly: App Name "Review Aggregator", one-line description, the Vercel URL as Domain,
  Category "Reporting", Owner "Chris McKee", Uses Anthropic API: No, Key Status: fresh dedicated
  keys (Google Places + Airtable PAT + Resend, none reused from another app).
