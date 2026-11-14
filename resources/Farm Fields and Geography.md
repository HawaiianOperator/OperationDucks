# Farmland, field boundaries, and hyperspectral data

## Field and farmland coverage

| Layer | Product, format, and access | What it represents |
| --- | --- | --- |
| Global field boundaries | [Fields of The World global release](https://source.coop/ftw/global-data) — CC BY 4.0. Country-partitioned GeoParquet and cloud-optimized confidence rasters. | Roughly 1.6 billion inferred field polygons per year for 2024 and 2025, derived from 10 m Sentinel-2 mosaics. Use the release's coverage index and confidence. Published paper and current distribution counts differ, so use the release manifest when reporting totals. |
| Global cropland extent | [ESA WorldCereal](https://esa-worldcereal.org/en/products/global-maps) — downloadable 10 m rasters. | Temporary crop extent, selected seasonal crop types and active irrigation in the 2021 release. Use its vintage in any map legend. Permanent crops and grazing need additional data. |
| Global land cover | [ESA WorldCover](https://esa-worldcover.org/en/data-access) — 10 m GeoTIFF tiles and map services. | Cropland, grassland and other land-cover classes. Grassland includes areas with different land uses, so pasture status needs supporting evidence. |
| U.S. field boundaries | [USDA Crop Sequence Boundaries](https://data.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/index.php) — free GIS downloads and viewer. Start with the 2018–2025 release. | Field polygons inferred from crop sequence and imagery. Read release metadata for regional coverage and geometry simplification. |
| U.S. crop type | [USDA Cropland Data Layer](https://www.nass.usda.gov/Research_and_Science/Cropland/Release/index.php) — annual categorical raster downloads. | USDA crop classes. Use the product vintage and a dominant-class share per polygon. Check the individual release for resolution and geography. |
| California crop fields | [DWR Statewide Crop Mapping](https://data.ca.gov/%40california-department-of-water-resources/statewide-crop-mapping) — shapefiles and map services, including provisional 2024. | Field-scale California crop mapping. Use where available for Central Valley crop labels and compare the boundaries with the global layer. |

The field datasets map observed or inferred agricultural units. Legal parcel geometry comes from the responsible cadastral authority. Coverage for pasture, orchards, smallholder farms, and recently changed fields varies by source. Use local datasets where available and expose unresolved gaps.

Anonymous HTTPS HEAD checks on November 14, 2026 returned HTTP 200 and advertised byte ranges for the [France field GeoParquet](https://data.source.coop/ftw/global-data/predictions/vectors/alpha/results-by-admin-conf/admin%3Acountry_code%3DFR/France.parquet) (2.37 GB) and [global confidence GeoTIFF](https://data.source.coop/ftw/global-data/predictions/confidence/confidence/prue_v1_confidence_global.tif) (1.12 GB). These checks verified endpoint access. File contents were not downloaded or decoded.

## Hyperspectral imagery

| Product | Measurements and format | Access and limits |
| --- | --- | --- |
| **NASA EMIT L2A** | 60 m surface reflectance across **285 bands**, 381–2493 nm. NetCDF-4 reflectance, uncertainty and mask files. | Find matching scenes with Earthdata or JPL coverage tools. Use the geolocation lookup table for spatial alignment and mask clouds and bad pixels. Scene coverage is acquisition-dependent. [Product specification](https://catalog.data.gov/dataset/emit-l2a-estimated-surface-reflectance-and-uncertainty-and-masks-60-m-v001) · [Coverage](https://earth.jpl.nasa.gov/emit/data/data-portal/coverage-and-forecasts/) |
| **DLR EnMAP L2A** | **30 m** imaging spectroscopy, **224 bands**, nominal 420–2450 nm. VNIR/SWIR GeoTIFF and other product formats. | Free/open policy. Search DLR Geoservice and EOWEB. Some access methods use registered credentials. Acquisition strips are targeted. [DLR Geoservice](https://web.geoservice.dlr.de/web/datasets/enmap) · [Mission access](https://www.enmap.org/data_access/) · [Sensor specification](https://elib.dlr.de/206808/1/1-s2.0-S003442572400405X-main.pdf) |
| **ASI PRISMA** | VNIR/SWIR hyperspectral scenes. Search for geocoded surface reflectance when matching fields. | Public acquisition footprints can be searched without registration. Science data require free PRISMA registration and applicable product terms. [ASI access](https://www.asi.it/en/2023/08/the-catalogue-of-prisma-acquisitions-is-now-freely-available-on-geoss-portal/) |
| **NASA AVIRIS** | Airborne imaging spectroscopy with higher-detail coverage where flights exist. | Check the JPL portal for flight footprints, dates and product levels. [AVIRIS downloads](https://aviris.jpl.nasa.gov/data/get_aviris_data.html) |

Read spectra from field interiors, track valid pixel counts, and retain wavelengths, sensor, acquisition time and masks. At 30–60 m, small fields may have too few uncontaminated pixels for field statistics. Use Sentinel-2 or Landsat multispectral products for broader agricultural monitoring. The one-to-two-hour weather map can display the latest valid spectrum beside its own acquisition date.

## Geography

| Layer | Product and access | Use |
| --- | --- | --- |
| Elevation | [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/) — public COG tiles, approximately 30 m | Surface elevation, hillshade, slope and aspect. Surface heights may include vegetation and structures. |
| Watersheds and rivers | [HydroBASINS](https://www.hydrosheds.org/products/hydrobasins) and [HydroRIVERS](https://www.hydrosheds.org/products/hydrorivers) — downloadable vector data | Join fields to upstream/downstream drainage context. Verify local irrigation canals from regional sources when needed. |
| Soil | [ISRIC SoilGrids](https://docs.isric.org/globaldata/soilgrids/) — mapped raster access | Approximately 250 m modeled soil properties by depth, including texture, organic carbon and pH. Field measurements are needed for field-specific verification. |
| Administrative geography | [geoBoundaries](https://www.geoboundaries.org/api.html) — API and GeoJSON links | Group and filter by country or administrative region. Use the source's boundary policy when mapping disputed regions. |

## OperationDucks integration

Use FTW for base geometry and add regional crop labels from USDA or DWR by overlap. Keep source IDs, boundary year, confidence and attribution. Serve vectors by extent or as tiles. Use the publisher's field-density raster at low zoom. Put spectral scenes in a footprint index and load only intersecting scenes. Keep hourly weather timestamps, crop map vintages and imagery acquisition times visible independently.

The first verification area is the Central Valley from the existing proposal. Compare available field polygons with California DWR and USDA, then check for qualifying hyperspectral scenes and compute valid-pixel coverage. This is a source catalog. A worldwide download, local scene overlap check, and raster decoding have not been run.
