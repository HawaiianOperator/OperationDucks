const maxBytes = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  const length = Number(request.headers.get("content-length"));
  if (!type.startsWith("audio/") || length > maxBytes || !request.body) {
    return Response.json({ error: "Record a short microphone clip and try again." }, { status: 400 });
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return Response.json({ error: "The microphone clip is too large." }, { status: 413 });
      }
      chunks.push(value);
    }
    if (!size) return Response.json({ error: "The microphone clip was empty." }, { status: 400 });
    const audio = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const response = await fetch("http://127.0.0.1:19232/transcribe", {
      method: "POST", body: audio, headers: { "Content-Type": type },
      cache: "no-store", signal: AbortSignal.timeout(20000),
    });
    return Response.json(await response.json(), { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Duck’s local transcription service is unavailable." }, { status: 503 });
  }
}
