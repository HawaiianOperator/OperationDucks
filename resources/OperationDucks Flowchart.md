# Farm Monitoring Flowchart

```mermaid
flowchart TD
    A["Select a farm field and draw or upload its boundary"] --> B["Choose the crop, date range, and comparison period"]
    B --> C["NASA POWER: air temperature and solar radiation"]
    B --> D["GPM IMERG: recent rainfall and accumulated precipitation"]
    B --> E["SMAP: regional surface soil moisture"]
    B --> F["Landsat: field-scale vegetation greenness from NDVI"]
    B --> G["ECOSTRESS: land surface temperature and evaporative stress"]
    B --> H["MODIS: historical vegetation and surface temperature baseline"]

    C --> I["Check coverage, acquisition dates, cloud masks, and quality flags"]
    D --> I
    E --> I
    F --> I
    G --> I
    H --> I
    I --> J{"Are the observations suitable for comparison?"}
    J -- "Missing, cloudy, or outdated" --> K["Label gaps and select a better date or an available substitute"]
    K --> B
    J -- "Yes" --> L["Map Landsat and ECOSTRESS observations where available"]
    J -- "Yes" --> M["Show coarser weather and soil moisture as regional context"]
    J -- "Yes" --> N["Use MODIS for seasonal context at its native scale"]
    L --> O["Compare greenness and surface heat over time"]
    M --> O
    N --> O

    O --> P{"Do usable observations show an unusual change?"}
    P -- "Yes" --> Q["Flag locations to inspect and show the evidence and its dates"]
    P -- "No" --> R["Record the current conditions and review after the next usable observation"]
    Q --> S["Check flagged areas in the field using crop observations and local measurements"]
    S --> T["Record findings and decide whether to adjust irrigation or investigate another cause"]
    T --> R
    R --> B
```

NDVI is a measure of greenness. A drop in NDVI or a warm surface can help prioritize a field visit. Compare observations from similar growth stages and use field measurements to investigate the cause. SMAP and GPM grids can cover multiple fields, so display them as regional context.
