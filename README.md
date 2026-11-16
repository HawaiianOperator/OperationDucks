# Operation Ducks

Operation Ducks is an interactive agricultural map built for the NASA Space Apps Challenge. It helps growers and students use satellite imagery, weather records, soil data, and crop history to investigate conditions on a farm field and compare crop rotation options.

Search for a location, draw a field boundary, and inspect the available data. Duck, the app's assistant, uses the selected field to answer questions such as “What could I plant next here?” Users can type a question or enable microphone dictation, then follow source links where available.

## Run locally

From the directory containing `package.json`, use Node.js 20.9 or newer and npm.

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Map and data views need internet access to reach their providers.

### Optional Duck services

To run Duck's Python backend locally, install PyTorch in a Python environment and export `router.pt` from [Train Duck.ipynb](Train%20Duck.ipynb). Place the checkpoint beside `duck_service.py` and run the following in a separate terminal.

```bash
python -m pip install torch
python duck_service.py
```

The backend listens at `http://127.0.0.1:8765/ask`. To use a hosted backend, set `DUCK_API_URL` in `.env.local` to the full request endpoint and restart Next.js.

For local microphone dictation, install the speech-recognition dependencies and start the transcription service in another terminal.

```bash
python -m pip install -r requirements-dictation.txt
python duck_dictation_service.py
```

Allow microphone access when prompted. Optional spoken replies use a separate service configured with `DUCK_VOICE_API_URL` and, if required by the service, `DUCK_VOICE_API_TOKEN`. Keep credentials in `.env.local`.

## Try the demo

1. Search for a farm location and draw a field boundary.
2. Review the field summary and switch between the available satellite layers.
3. Compare the latest eligible month's rainfall with the same month in each of the previous 10 years.
4. Ask Duck for crop rotation options and open the supporting sources when available.

## NASA data

| Source | How Operation Ducks uses it |
| --- | --- |
| [NASA POWER](https://power.larc.nasa.gov/) | Provides weather data such as rainfall and air temperature. The rainfall view compares one calendar month across 11 years. |
| [NASA Worldview](https://worldview.earthdata.nasa.gov/) and [NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs) | Provide map imagery layers including MODIS Terra and Aqua true color and MODIS daytime land surface temperature. The Terra true-color archive extends back to February 2000. |

Imagery availability varies by date, location, and sensor. Clouds can obscure observations, crop-history coverage varies by region, and a weather grid cell can cover multiple fields. Use the map to identify conditions or rotation options worth checking locally.

See the [NASA resource notes](resources/NASA%20Data%20Resources.md) and [crop rotation data notes](resources/Crop%20Rotation%20Data.md) for additional references.

## Technology

The web app uses TypeScript, React, Next.js, and MapLibre GL. Duck's backend uses Python, with PyTorch and Jupyter notebooks for model development and evaluation. Local dictation uses faster-whisper.
