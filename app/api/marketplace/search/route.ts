// MRI v3 — proxy to the ScrapeCreators Marketplace Search endpoint.
// Keeps SCRAPECREATORS_API_KEY server-side; forwards all query params through.

import { searchRunpodListings } from "@/lib/server/runpodBackend";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const runpodResponse = await searchRunpodListings({
    query: searchParams.get("query") || "iPhone",
    location: searchParams.get("location") || "",
    limit: Number(searchParams.get("count") || searchParams.get("limit") || 10),
  });
  if (runpodResponse) {
    try {
      const data = await runpodResponse.json();
      if (runpodResponse.ok) return Response.json(data, { status: runpodResponse.status });
      console.error("[/api/marketplace/search] RunPod error:", data);
    } catch (err) {
      console.error("[/api/marketplace/search] RunPod response parse error:", err);
    }
  }

  if (!process.env.SCRAPECREATORS_API_KEY) {
    return Response.json(
      { error: "SCRAPECREATORS_API_KEY not configured", listings: [] },
      { status: 503 }
    );
  }

  const upstream = new URL(
    "https://api.scrapecreators.com/v1/facebook/marketplace/search"
  );
  for (const [key, value] of searchParams.entries()) {
    upstream.searchParams.set(key, value);
  }

  try {
    const response = await fetch(upstream.toString(), {
      headers: { "x-api-key": process.env.SCRAPECREATORS_API_KEY },
      cache: "no-store",
    });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (err) {
    console.error("[/api/marketplace/search] upstream error:", err);
    return Response.json({ error: "Upstream search failed", listings: [] }, { status: 502 });
  }
}
