import { NextRequest, NextResponse } from "next/server";

type Transmitter = {
  norad_cat_id: number;
  description: string;
  downlink_low: number | null;
  downlink_high: number | null;
  mode: string | null;
  status: string;
};

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("norad") ?? "";
  if (!/^\d{1,9}$/.test(id)) return NextResponse.json({ error: "Invalid NORAD ID." }, { status: 400 });
  try {
    const response = await fetch(`https://db.satnogs.org/api/transmitters/?satellite__norad_cat_id=${id}`, {
      next: { revalidate: 3600 }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("SatNOGS unavailable");
    const rows: Transmitter[] = await response.json();
    const records = rows
      .filter(row => Number(row.norad_cat_id) === Number(id) && (row.downlink_low > 0 || row.downlink_high > 0))
      .map(({ description, downlink_low, downlink_high, mode, status }) => ({
        description, low: downlink_low, high: downlink_high, mode, status,
      }));
    return NextResponse.json({ records });
  } catch {
    return NextResponse.json({ error: "SatNOGS reception lookup is unavailable." }, { status: 502 });
  }
}
