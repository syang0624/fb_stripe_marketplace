// MRI v3 — proxy to the ScrapeCreators Marketplace Location Search.
// Turns a location string into coordinates. Falls back to San Francisco coords
// if the key is missing or the upstream call fails, so search always proceeds.

const SF_FALLBACK = { lat: 37.7749, lng: -122.4194, location: "San Francisco, CA", fallback: true };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query") ?? "";

  if (!process.env.SCRAPECREATORS_API_KEY) {
    return Response.json(SF_FALLBACK);
  }

  const upstream = new URL(
    "https://api.scrapecreators.com/v1/facebook/marketplace/location/search"
  );
  if (query) upstream.searchParams.set("query", query);

  try {
    const response = await fetch(upstream.toString(), {
      headers: { "x-api-key": process.env.SCRAPECREATORS_API_KEY },
      cache: "no-store",
    });
    if (!response.ok) return Response.json(SF_FALLBACK);
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (err) {
    console.error("[/api/marketplace/location] upstream error, using SF fallback:", err);
    return Response.json(SF_FALLBACK);
  }
}
