import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { rating, correction, question, answer } = body ?? {};
  if (!["helpful", "needs-correction"].includes(rating) ||
    typeof correction !== "string" || correction.length > 1000 ||
    typeof question !== "string" || !question.trim() || question.length > 1000 ||
    typeof answer !== "string" || !answer.trim() || answer.length > 16000) {
    return Response.json({ error: "Choose a rating and keep the correction under 1,000 characters." }, { status: 400 });
  }
  const directory = join(process.cwd(), ".duck-model");
  const record = {
    id: randomUUID(), submittedAt: new Date().toISOString(),
    rating, correction: correction.trim(), question: question.trim(), answer,
  };
  try {
    await mkdir(directory, { recursive: true });
    await appendFile(join(directory, "feedback.jsonl"), JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 });
    return Response.json({ id: record.id }, { status: 201 });
  } catch {
    return Response.json({ error: "Duck could not save the feedback." }, { status: 500 });
  }
}
