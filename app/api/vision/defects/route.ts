import { detectRunpodDefects } from "@/lib/server/runpodBackend";

export async function POST(req: Request) {
  const body = (await req.json()) as { image_urls?: string[]; imageUrls?: string[] };
  const imageUrls = body.image_urls ?? body.imageUrls ?? [];

  if (!imageUrls.length) {
    return Response.json({ reports: [] });
  }

  const runpodResponse = await detectRunpodDefects({ image_urls: imageUrls });
  if (!runpodResponse) {
    return Response.json(
      { error: "RUNPOD_VISION_BASE_URL or RUNPOD_BACKEND_BASE_URL not configured", reports: [] },
      { status: 503 }
    );
  }

  try {
    const data = await runpodResponse.json();
    return Response.json(data, { status: runpodResponse.status });
  } catch (err) {
    console.error("[/api/vision/defects] RunPod response parse error:", err);
    return Response.json({ error: "RunPod vision response was not valid JSON", reports: [] }, { status: 502 });
  }
}
