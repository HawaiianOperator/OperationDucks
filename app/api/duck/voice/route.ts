export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.text !== "string" || !body.text.trim() || body.text.length > 4000) {
    return Response.json({ error: "Choose an answer of up to 4,000 characters to read aloud." }, { status: 400 });
  }
  const url = process.env.DUCK_VOICE_API_URL?.trim();
  if (!url) return Response.json({ error: "Duck’s voice service is awaiting setup." }, { status: 503 });
  const token = process.env.DUCK_VOICE_API_TOKEN?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(url, {
      method: "POST", headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ text: body.text, locale: "en-GB-scotland" }),
    });
    if (response.status === 429) return Response.json({ error: "Duck’s voice is busy. Try again shortly." }, { status: 429 });
    if (!response.ok || !response.body || !response.headers.get("Content-Type")?.startsWith("audio/wav")) {
      return Response.json({ error: "Duck’s voice service could not generate audio." }, { status: 502 });
    }
    return new Response(response.body, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Duck’s voice service is unavailable." }, { status: 503 });
  }
}
export function GET() {
  return Response.json({ configured: Boolean(process.env.DUCK_VOICE_API_URL?.trim()) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

