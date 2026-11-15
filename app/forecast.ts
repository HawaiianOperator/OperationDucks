const forecastKeys = [
  "temperature_2m_min", "temperature_2m_max", "precipitation_sum",
  "precipitation_probability_max", "wind_gusts_10m_max", "et0_fao_evapotranspiration",
] as const;

type DailyForecast = { time: string[] } & Record<typeof forecastKeys[number], (number | null)[]>;

export async function forecast(lat: number, lon: number): Promise<{ url: string; daily: DailyForecast; timezone: string }> {
  const query = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), daily: forecastKeys.join(","),
    timezone: "auto", forecast_days: "7",
  });
  const url = "https://api.open-meteo.com/v1/forecast?" + query;
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Forecast unavailable");
  const data = await response.json();
  if (!Array.isArray(data.daily?.time) || !data.daily.time.length ||
      forecastKeys.some(key => data.daily[key]?.length !== data.daily.time.length)) {
    throw new Error("Forecast unavailable");
  }
  return { url, daily: data.daily, timezone: data.timezone };
}
