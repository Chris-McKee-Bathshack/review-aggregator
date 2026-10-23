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

/**
 * Current aggregate rating + review count for a Place ID.
 * Returns null (not zeros) on any failure — a failed call is "not checked", never "no reviews".
 */
export async function getPlaceRating(placeId: string): Promise<PlaceRating | null> {
  const res = await fetch(`${PLACES_API_BASE}/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "rating,userRatingCount",
    },
  });

  if (!res.ok) {
    console.error(`Place Details failed for ${placeId}: ${res.status} ${await res.text()}`);
    return null;
  }

  const data = (await res.json()) as { rating?: number; userRatingCount?: number };
  return {
    rating: typeof data.rating === "number" ? data.rating : null,
    reviewCount: typeof data.userRatingCount === "number" ? data.userRatingCount : null,
  };
}
