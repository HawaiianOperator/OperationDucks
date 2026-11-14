# NASA Hackathon Team Board

## Set up the board

Create a board titled **NASA Hackathon | Fire & Weather Intelligence**. Add six frames using the headings below. Open the companion [sticky-note CSV](Miro%20Team%20Stickies.csv) in Google Sheets or Excel, then copy the cards from one column at a time. Paste each column into its matching Miro frame as sticky notes. Replace role placeholders with team names and move work cards through Backlog, In progress, Review, and Done. [Miro sticky-note guide](https://help.miro.com/hc/en-us/articles/360017572054-Sticky-notes)

## Mission and scope

Help a user investigate wildfire hotspot detections alongside local weather and learn which satellite observations are available. Start with one California region and a short historical replay window. Pick a date with FIRMS coverage and available Meteomatics data. Demo success means a judge can choose a hotspot, inspect its timestamp and source, see nearby wind for the selected time, and ask the map guide to explain the evidence.

## Ground stations

| Option | What the team can use |
| --- | --- |
| Google Cloud | Recommended app host if the team has access. Google's documented Leaf Space example runs scheduling infrastructure on Google Cloud. Leaf Space operates the antenna network. A direct, first-party Google Cloud station booking service was not verified. [Google Cloud case study](https://cloud.google.com/blog/topics/startups/leaf-space-enabling-next-gen-satellites-on-google-cloud) |
| Microsoft Azure | Azure Orbital Ground Station access for existing private spacecraft ended December 18, 2024. Azure can still serve as the app host. [Microsoft retirement notice](https://learn.microsoft.com/en-us/azure/orbital/overview) |
| AWS Ground Station or KSATlite | Potential live downlink for a specific mission. AWS requires onboarding and technical and licensing review, and supports a defined set of public broadcast satellites. KSATlite offers small-satellite ground services. Confirm spacecraft operator, authorization, payload data rights, frequency, coverage, and access timing before committing. [AWS onboarding](https://docs.aws.amazon.com/ground-station/latest/ug/getting-started.step1.html) · [KSATlite](https://www.ksat.no/ground-network-services/ksatlite/) |
| SatNOGS | Start with a public CubeSat observation. Capture station, NORAD ID, observation time, reception status, and source link. Label orbital positions as estimates if added. Use a mission-specific payload dataset if CubeSat imagery becomes a requirement. [SatNOGS Network](https://network.satnogs.org/about/) |

## Data and architecture

- **Fire** — NASA FIRMS VIIRS detections for the selected area and time. Request the free MAP_KEY. Store coordinates, observation time, source, confidence, and retrieval time. Plot detections as points. [FIRMS API](https://firms.modaps.eosdis.nasa.gov/api/)
- **Weather** — Pull Meteomatics wind speed and direction for the selected area and time. Check account access, historical coverage, units, and which direction convention the arrows use. Label weather valid time and data mode. [Meteomatics parameters](https://www.meteomatics.com/en/api/available-parameters/weather-parameter/)
- **Space** — Select one CubeSat and one public reception from SatNOGS. Show the reception in a satellite panel with the station and UTC timestamp. Keep FIRMS attribution on the fire layer. [SatNOGS Network](https://network.satnogs.org/about/)
- **Pipeline** — Provider adapters → cached map API → dashboard and AI guide. Keep credentials server-side. Give the layers a shared UTC clock. Use a small, labeled replay for the demo when permitted by provider terms. Show unavailable inputs in their own layer status.

## Dashboard and AI guide

For additional map layers, use the [data catalog](NASA%20Data%20Resources.md). NASA POWER adds air temperature, rainfall, and solar radiation. GPM IMERG adds precipitation estimates, and SMAP adds soil moisture. Landsat NDVI shows vegetation greenness, ECOSTRESS provides land surface temperature and plant stress indicators, and MODIS provides historical vegetation and surface temperature layers. Before adding a layer to the replay, verify regional coverage and show its observation or composite window so the AI guide can explain which records are comparable.

Use Osiris as the visual reference. Dark charcoal map, compact left layer controls, a central map, a right context and AI panel, and a bottom UTC timeline. Use amber for fire, blue for wind, and violet for space observations. Show the selected source and observation or forecast time alongside each feature. [Osiris live UI](https://osirisai.live/) · [Osiris repository](https://github.com/simplifaisoul/osiris)

For the first demo, customize an existing model with map tools and instructions. Give it read access to the visible area, selected feature, timeline, and layer records. Let it propose a map highlight or filter for the user to apply. Answers should cite data records and identify missing coverage. Example prompt — “What was the wind near this hotspot at the time of detection?” The answer should distinguish the measured or forecast wind from any inference about fire behavior. Use the demo evaluation prompts to decide later whether fine-tuning would help.

## Team and backlog

| Owner | First deliverable | Done when |
| --- | --- | --- |
| Product and demo | Select user, region, and replay window | A single judge walkthrough is written and repeatable |
| Data and cloud | Wire FIRMS and Meteomatics | Both layers return records for the same region and time with source metadata |
| Satellite | Find a CubeSat and an observation | The space panel links to a real reception with a station and UTC time |
| Design and frontend | Build map shell and interactions | Layer toggles, feature selection, and timeline work together |
| AI and evaluation | Connect map context and evidence tools | The guide explains a hotspot, identifies missing weather, and identifies the CubeSat reception source |

Combine roles if needed. Each card should have one owner, a due time, and a visible result. Agree on the replay window before wiring the layers.

## Demo and decisions

1. Open the replay and select a FIRMS hotspot.
2. Enable wind and scrub the timeline. Inspect the hotspot and weather timestamps.
3. Ask the guide to explain the local wind and open its evidence links.
4. Switch to the space panel and inspect the CubeSat reception.
5. Show how the guide handles an area or time with missing data.

Record decisions for demo region, date window, hosting account, Meteomatics entitlement, and CubeSat ID. For any live pass, add the operator and confirmed ground-station route.
