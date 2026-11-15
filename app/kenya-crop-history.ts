import { fromUrl } from "geotiff";

const documentation = "https://land.copernicus.eu/en/use-cases/from-crop-maps-to-local-knowledge-in-kenya/from-crop-maps-to-local-knowledge-in-kenya";
const directory = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/Copernicus4GEOGLAM/Kenya/Crop_Maps%26Area_estimates/";
// End-of-season mapping report, table 3. Named classes can include mixed crops.
const names = new Map([[1, "Maize-dominant crops"], [4, "Bean-dominant crops"], [11, "Sorghum-dominant crops"],
  [13, "Green gram-dominant crops"], [14, "Wheat-dominant crops"], [19, "Sugarcane-dominant crops"],
  [6, "Tea-dominant crops"], [12, "Pea-dominant crops"], [9, "Other crops or field preparation"], [10, "Other land cover"]]);
const common = [[1, "Maize-dominant crops"], [4, "Bean-dominant crops"], [11, "Potato-dominant crops"],
  [13, "Wheat-dominant crops"], [14, "Sugarcane-dominant crops"], [10, "Other land cover"]] as const;
const seasons = [
  { year: 2021, label: "2021 long rains", folder: "Long_Rains2021", file: "Kenya_CropType_EndOfSeason_LongRains_2021.tif",
    names: new Map<number, string>([...common, [3, "Millet"], [15, "Tea"], [16, "Rice"], [9, "Other crops"]]) },
  { year: 2021, label: "2021 short rains", folder: "Short_Rains2021", mappingFolder: "03_Task_5",
    file: "Kenya_CropType_EndOfSeason_ShortRains_2021.tif",
    names: new Map<number, string>([...common, [15, "Tea-dominant crops"], [20, "Elephant grass-dominant crops"],
      [21, "Banana-dominant crops"], [9, "Other crops"]]) },
  { year: 2022, label: "2022–23 short rains", folder: "Short_Rain2022", file: "Kenya_CropType_EndOfSeason_ShortRains_2022-2023.tif",
    names: new Map<number, string>([...common, [19, "Peas"], [6, "Green gram-dominant crops"], [12, "Rice"], [9, "Other crops or field preparation"]]) },
  { year: 2023, label: "2023 long rains", folder: "Long_Rain2023", file: "D5.1_Kenya_CropType_EndOfSeason_LongRains_2023.tif", names },
];

async function openImage(url: string) {
  const raster = await fromUrl(url, { allowFullFile: false }, AbortSignal.timeout(10000));
  const image = await raster.getImage();
  if (![32636, 32737].includes(image.getGeoKeys().ProjectedCSTypeGeoKey)) throw new Error("Unexpected Kenya crop-map projection");
  return image;
}
const images = new Map<string, ReturnType<typeof openImage>>();

// WGS84 transverse Mercator series for the two UTM grids used by the archive.
function project(lat: number, lon: number, epsg: number) {
  const radians = Math.PI / 180;
  const latitude = lat * radians;
  const eccentricity = 0.00669437999014;
  const secondEccentricity = eccentricity / (1 - eccentricity);
  const sine = Math.sin(latitude);
  const cosine = Math.cos(latitude);
  const tangent = Math.tan(latitude);
  const n = 6378137 / Math.sqrt(1 - eccentricity * sine ** 2);
  const a = (lon - (epsg === 32737 ? 39 : 33)) * radians * cosine;
  const t = tangent ** 2;
  const c = secondEccentricity * cosine ** 2;
  const e2 = eccentricity ** 2;
  const e3 = eccentricity ** 3;
  const arc = 6378137 * ((1 - eccentricity / 4 - 3 * e2 / 64 - 5 * e3 / 256) * latitude
    - (3 * eccentricity / 8 + 3 * e2 / 32 + 45 * e3 / 1024) * Math.sin(2 * latitude)
    + (15 * e2 / 256 + 45 * e3 / 1024) * Math.sin(4 * latitude) - (35 * e3 / 3072) * Math.sin(6 * latitude));
  return [
    500000 + 0.9996 * n * (a + (1 - t + c) * a ** 3 / 6 + (5 - 18 * t + t ** 2 + 72 * c - 58 * secondEccentricity) * a ** 5 / 120),
    (epsg === 32737 ? 10000000 : 0) + 0.9996 * (arc + n * tangent * (a ** 2 / 2 + (5 - t + 9 * c + 4 * c ** 2) * a ** 4 / 24
      + (61 - 58 * t + t ** 2 + 600 * c - 330 * secondEccentricity) * a ** 6 / 720)),
  ];
}

export async function kenyaCropHistory(lat: number, lon: number) {
  const result = { method: "kenya" as const, documentation, url: directory };
  const outside = { ...result, status: "outside", fields: [] };
  const observations = await Promise.allSettled(seasons.map(async season => {
    const url = `${directory}${season.folder}/${season.mappingFolder ?? "D5_EndSeasonMapping"}/D5.1_crop_type_mapping/${season.file}`;
    if (!images.has(url)) images.set(url, openImage(url).catch(error => { images.delete(url); throw error; }));
    const image = await images.get(url);
    const [x, y] = project(lat, lon, image.getGeoKeys().ProjectedCSTypeGeoKey);
    const [originX, originY] = image.getOrigin();
    const [dx, dy] = image.getResolution();
    const column = Math.floor((x - originX) / dx);
    const row = Math.floor((y - originY) / dy);
    if (column < 0 || column >= image.getWidth() || row < 0 || row >= image.getHeight()) return null;
    const data = await image.readRasters({ window: [column, row, column + 1, row + 1],
      samples: [0], interleave: true, signal: AbortSignal.timeout(10000) });
    const code = data[0];
    const crop = season.names.get(code);
    return crop ? { year: season.year, code, crop, season: season.label } : null;
  }));
  const history = observations.flatMap(item => item.status === "fulfilled" && item.value ? [item.value] : []);
  const incompleteYears = seasons.filter((_, index) => observations[index].status === "rejected").map(season => season.year);
  if (!history.length && incompleteYears.length) throw new Error("Kenya seasonal crop data unavailable");
  return history.length ? { ...result, status: "found", incompleteYears,
    fields: [{ id: "kenya-seasonal-pixel", acres: null, county: "", history }] } : outside;
}
