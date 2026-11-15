import { fromUrl } from "geotiff";

const documentation = "https://zenodo.org/records/21349862";
export const indiaSeasonalRiceSource = "https://doi.org/10.6084/m9.figshare.24228619";
const zenodo = (name: string) => `https://zenodo.org/api/records/21349862/files/${encodeURIComponent(name)}/content`;
const files = [
  { year: 2015, url: zenodo("South and Southeast Asia Paddy Rice 2015.tif"), crop: "Paddy rice (reference-year composite)", maximumCode: 3 },
  { year: 2018, url: "https://ndownloader.figshare.com/files/42535672", crop: "Paddy rice (winter raster)", maximumCode: 1 },
  { year: 2020, url: "https://ndownloader.figshare.com/files/42528511", crop: "Paddy rice (winter raster)", maximumCode: 1 },
  { year: 2022, url: "https://ndownloader.figshare.com/files/42534418", crop: "Paddy rice (winter raster)", maximumCode: 1 },
  { year: 2024, url: zenodo("India North 2024.tif"), crop: "Paddy rice (reference-year composite)", maximumCode: 3 },
];

async function openImage(url: string) {
  const tiff = await fromUrl(url, { allowFullFile: false, headers: { "User-Agent": "OperationDucks dataset audit" } },
    AbortSignal.timeout(12000));
  const image = await tiff.getImage();
  const keys = image.getGeoKeys();
  if (keys.GeographicTypeGeoKey !== 4326 || keys.ProjectedCSTypeGeoKey || image.getSamplesPerPixel() !== 1) {
    throw new Error("Unexpected paddy rice raster format");
  }
  return image;
}

const images = new Map<string, ReturnType<typeof openImage>>();

export async function indiaRiceHistory(lat: number, lon: number) {
  const result = { method: "indiaRice" as const, documentation, url: documentation };
  const results = await Promise.allSettled(files.map(async ({ year, url, crop, maximumCode }) => {
    if (!images.has(url)) images.set(url, openImage(url).catch(error => { images.delete(url); throw error; }));
    const image = await images.get(url);
    const [x, y] = image.getOrigin();
    const [dx, dy] = image.getResolution();
    const column = Math.floor((lon - x) / dx);
    const row = Math.floor((lat - y) / dy);
    if (column < 0 || row < 0 || column >= image.getWidth() || row >= image.getHeight()) return null;
    const values = await image.readRasters({ window: [column, row, column + 1, row + 1],
      samples: [0], interleave: true, signal: AbortSignal.timeout(12000) });
    const code = values[0];
    // A positive pixel establishes rice presence. Zero does not identify a different crop.
    return code >= 1 && code <= maximumCode ? { year, code, crop } : null;
  }));
  const history = results.flatMap(item => item.status === "fulfilled" && item.value ? [item.value] : []);
  const incompleteYears = files.filter((_, index) => results[index].status === "rejected").map(file => file.year);
  if (!history.length && incompleteYears.length) throw new Error("Rice map lookup incomplete");
  return history.length ? { ...result, status: "found", incompleteYears,
    fields: [{ id: "rice-composite-pixel", acres: null, county: "", history }] } :
    { ...result, status: "empty", incompleteYears, fields: [] };
}
