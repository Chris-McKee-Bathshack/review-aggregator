// Thin wrapper around Google's Places API (New).
// Needs "Places API (New)" enabled + billing on the Google Cloud project the key belongs to.
// No approval queue for this one (unlike the Business Profile API) — just enablement + billing.

const PLACES_API_BASE = "https://places.googleapis.com/v1";

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  return key;
}

/**
 * One-time (then cached) lookup: resolves a showroom's Place ID from its name + town.
 * Returns null if nothing matched — caller should treat that as "not checked", not "zero reviews".
 */
export async function resolvePlaceId(name: string, town: string): Promise<string | null> {
  const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery: `${name} ${town}` }),
  });

  if (!res.ok) {
    console.error(`Places text search failed for "${name} ${town}": ${res.status} ${await res.text()}`);
    return null;
  }

  const data = (await res.json()) as { places?: { id: string }[] };
  return data.places?.[0]?.id ?? null;
}

export type PlaceRating = {
  rating: number | null;
  reviewCount: number | null;
};

export type PlaceLookup = {
  rating: PlaceRating | null;
  /** Why the check failed (HTTP status + Google's message), or null if the call worked. Never contains the API key. */
  error: string | null;
};

function shorten(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Current aggregate rating + review count for a Place ID.
 * A failed call returns rating: null plus the reason, never zeros: "not checked" is not "no reviews".
 */
export async function getPlaceRating(placeId: string): Promise<PlaceLookup> {
  const url = `${PLACES_API_BASE}/places/${encodeURIComponent(placeId)}`;
  const init = { headers: { "X-Goog-Api-Key": apiKey(), "X-Goog-FieldMask": "rating,userRatingCount" } };

  let lastError = "unknown error";
  // One retry for transient problems (rate limit or Google-side 5xx / network blip).
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      const res = await fetch(url, init);
      if (res.ok) {
        const data = (await res.json()) as { rating?: number; userRatingCount?: number };
        return {
          rating: {
            rating: typeof data.rating === "number" ? data.rating : null,
            reviewCount: typeof data.userRatingCount === "number" ? data.userRatingCount : null,
          },
          error: null,
        };
      }
      lastError = `Google returned ${res.status}: ${shorten(await res.text())}`;
      console.error(`Place Details failed for ${placeId}: ${lastError}`);
      if (res.status !== 429 && res.status < 500) break; // permanent (key, billing, permissions): don't retry
    } catch (err) {
      lastError = `Network error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`Place Details failed for ${placeId}: ${lastError}`);
    }
  }
  return { rating: null, error: lastError };
}
