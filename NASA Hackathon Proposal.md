# Fire & Weather Intelligence

**NASA Hackathon project proposal**

## Summary

When a satellite detects a potential wildfire hotspot, the people reviewing it still need to answer basic questions. When was it observed? What was the wind nearby? Which layers cover the same place and time? Fire & Weather Intelligence brings those answers into a single map. Users can replay an event, inspect the underlying observations, and ask an AI guide to explain what the available evidence supports.

The first version will demonstrate one historical California wildfire scenario. It will combine NASA FIRMS hotspot detections and Meteomatics wind data, with a separate view of a real CubeSat reception. The team will choose the region and dates after checking data availability.

## Who it serves

The initial user is a student or analyst exploring Earth observation data during a wildfire event. Their task is to build a brief, verifiable account of what the satellite detected and what the surrounding weather looked like. The same interface can help a judge explore the evidence without prior knowledge of the feeds.

## Product experience

The interface takes its visual cues from Osiris. A dark, map-first workspace places layer controls on the left, the selected feature and AI guide on the right, and a UTC replay timeline along the bottom. Hotspots use amber, wind uses blue, and satellite receptions use violet. Each feature shows its source and observation or valid time. Layer status shows when data is unavailable for the selected place or time. [Osiris live interface](https://osirisai.live/) · [Osiris repository](https://github.com/simplifaisoul/osiris)

A user selects a hotspot, enables the wind layer, and asks, “What did the available weather data show near this hotspot at the time of detection?” The guide retrieves the selected detection and nearby wind records, explains their times and units, and links back to the evidence. It can suggest a map highlight or time filter for the user to apply. If the available records do not cover the requested time, the guide identifies the gap.

## Data and integration

See the [initial satellite and data evaluation](resources/Satellite%20and%20Data%20Evaluation.md) for candidate products, direct-broadcast frequencies, receiver requirements, and first tests.

| Source | Role in the proposal |
| --- | --- |
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/) | Core fire layer. Fetch VIIRS hotspot points with acquisition time, sensor, confidence, and source. |
| [Meteomatics](https://www.meteomatics.com/en/api/available-parameters/weather-parameter/) | Core weather layer. Retrieve wind speed and direction for the replay region and record the valid time, units, and available product type. Historical access is a dependency. |
| [SatNOGS](https://network.satnogs.org/about/) | Core space panel. Show one public CubeSat reception with spacecraft ID, ground station, UTC time, and a source link. |
| [NASA POWER](https://power.larc.nasa.gov/) | Optional context for air temperature, rainfall, and solar radiation. |
| [SMAP](https://access.earthdata.nasa.gov/collections/C2830464655-NSIDC_CPRD) and [GPM IMERG](https://gpm.nasa.gov/data/imerg) | Optional soil moisture and precipitation layers. |
| [Landsat NDVI](https://www.usgs.gov/landsat-missions/landsat-normalized-difference-vegetation-index) | Optional vegetation greenness and change layer. |
| [ECOSTRESS](https://ecostress.jpl.nasa.gov/) and [MODIS](https://cmr.earthdata.nasa.gov/search/site/collections/directory/LPCLOUD/gov.nasa.eosdis) | Optional land surface temperature, plant stress, and historical vegetation context. |

The backend will fetch and normalize records, retain provenance and units, and serve the dashboard and guide from the same map API. Each record will carry UTC timestamps or a composite window, with spatial resolution and quality indicators where available. This lets the map show when two layers are actually comparable. Keep provider credentials on the server and verify terms before storing or redistributing replay data.

## Ground stations and hosting

Google Cloud is the proposed app host if the team has access. Google's documented ground-station example uses antenna infrastructure operated by Leaf Space. Azure Orbital Ground Station ended access for existing private spacecraft on December 18, 2024. The demo can run from public SatNOGS reception records. If the team secures a CubeSat mission partner, evaluate a live pass through AWS Ground Station, KSATlite, or Leaf Space after confirming spacecraft permission, radio compatibility, and payload data rights. A CubeSat reception demonstrates the space-to-ground link. Earth imagery from a CubeSat would require an identified imaging payload and access to its products. [Google Cloud and Leaf Space](https://cloud.google.com/blog/topics/startups/leaf-space-enabling-next-gen-satellites-on-google-cloud) · [Microsoft retirement notice](https://learn.microsoft.com/en-us/azure/orbital/overview) · [AWS onboarding](https://docs.aws.amazon.com/ground-station/latest/ug/getting-started.step1.html) · [KSATlite](https://www.ksat.no/ground-network-services/ksatlite/)

## AI guide

Start with an existing model and customize it with domain instructions and read-only map tools. Give it the current viewport, selected feature, visible layers, and time range. Require each factual claim about the event to trace to a record and show whether that record is a detection, estimate, or forecast. Evaluate explanations about wind direction, gaps in coverage, and satellite reception provenance. Use the results to decide whether a fine-tuned model would improve the guide.

## Execution plan

| Workstream | First milestone | Completion check |
| --- | --- | --- |
| Product and demo | Pick one event and define the walkthrough | A team member can repeat the scenario from a clean session. |
| Data and cloud | Verify Meteomatics access and assemble overlapping records | FIRMS and wind data cover the selected region and replay window, with source and time visible. |
| Satellite | Select a CubeSat and a public reception | The space panel opens the observation source and displays the station and UTC time. |
| Design and frontend | Build the map, layer controls, and timeline | Selecting a hotspot updates the context panel and the guide receives the same selection. |
| AI and evaluation | Connect the guide and run scripted questions | It cites the correct evidence and identifies an intentionally missing record. |

Use the [Miro team template](Miro%20Team%20Board.md) to assign one owner per workstream and track decisions. Confirm the replay window and source coverage first, then connect the map layers, integrate the AI guide, and rehearse the walkthrough.

## Demo and acceptance criteria

1. Open the replay and select one hotspot. Show where and when FIRMS detected it.
2. Enable wind and move the timeline. Show the weather valid time beside the hotspot acquisition time.
3. Ask the guide about nearby wind. Open the links supporting its answer.
4. Open the space panel and verify a real CubeSat observation against its source.
5. Select a time or area with missing data and show how the interface and guide report it.

The hackathon deliverables are a working replay, a source catalog, a Miro team board, and a repeatable walkthrough. Immediate decisions are team owners, the region and date, Meteomatics access, the CubeSat observation, and the hosting account.
