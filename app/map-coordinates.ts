type Coordinates = [longitude: number, latitude: number];

const decimalPair = /^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/;
const angle = String.raw`(\d{1,3}(?:\.\d+)?)\s*(?:[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*(?:(\d+(?:\.\d+)?)\s*["″”]\s*)?)?)?\s*`;
const compassPair = new RegExp("^" + angle + "([NS])\\s*[,;]?\\s*" + angle + "([EW])$", "i");

function compassAngle(degrees: string, minutes: string, seconds: string, direction: string) {
  const d = Number(degrees), m = Number(minutes ?? 0), s = Number(seconds ?? 0);
  if (m >= 60 || s >= 60 || (minutes && !Number.isInteger(d)) || (seconds && !Number.isInteger(m))) return NaN;
  return (d + m / 60 + s / 3600) * (/[SW]/i.test(direction) ? -1 : 1);
}

export function parseMapCoordinates(input: string): Coordinates | "invalid" | null {
  const decimal = decimalPair.exec(input.trim());
  const compass = decimal ? null : compassPair.exec(input.trim());
  if (!decimal && !compass) return /[°º′″]/.test(input) ? "invalid" : null;
  const lat = decimal ? Number(decimal[1]) : compassAngle(compass[1], compass[2], compass[3], compass[4]);
  const lon = decimal ? Number(decimal[2]) : compassAngle(compass[5], compass[6], compass[7], compass[8]);
  return Math.abs(lat) <= 85.051129 && Math.abs(lon) <= 180 ? [lon, lat] : "invalid";
}
