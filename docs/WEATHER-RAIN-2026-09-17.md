# Weather and rain refinement

Source change only; no installer, local installation or publication performed.

Weather uses the chosen city's fixed coarse coordinates (Brisbane by default), not GPS. MET Norway Locationforecast supplies cloud coverage, temperature, precipitation amount/period and a weather symbol. The UI requests a snapshot each visible minute; the native service caches according to provider expiry with a ten-minute minimum and thirty-minute default. It selects the nearest forecast timestamp within three hours, preferring the next one-hour summary, then six/twelve hours. This is forecast-driven artwork, not radar or lightning detection. Offline cached forecasts are labelled saved; no cache means time-only scenery. Current fallback can retain an old cached forecast indefinitely while offline.

Thunder symbols already map to storm, including snowy/sleety thunder symbols, which currently use the rain storm treatment. Clouds dim celestial bodies and tint the sky. Snow and fog have their own layers. Time of day interpolates a fixed decorative schedule in the selected timezone; sunrise/sunset is not astronomical. No measured wind, radar, warning feed or thunder audio is implemented.

Replaced four tiled SVG rain strokes and a shared 1.5-second loop with canvas drops independently recycled at varied depth, speed, length, width and opacity. Density follows hourly precipitation; corrected six/twelve-hour accumulation normalization. Decorative multi-period gusts alter direction; storm mode adds slant/speed and low-contrast 1.8-second cloud illumination at randomized 14–32 second intervals. No rapid flashes. Canvas capped at 600 drops, 30 fps and 1.5 pixel ratio; hidden/off stops and clears rendering, reduced motion produces a static field. Defensive per-frame stop check covers media changes even before a media event is delivered.

Changed desktop landscape.js/css and scene-time.js and copied these exact files into app/public/scene. Preserve other concurrent source changes and release versions.

Validation: 31 weather/time/control tests pass, including hourly-intensity normalization and thunder symbol mapping. Native Electron fictional-profile test checks changing pixels, storm rendering, hidden/off clearing and static reduced motion; screenshots visually reviewed. Evidence in output/weather-preview; simulated forecasts, not live storm verification. Run native check with PLAYWRIGHT_MODULE pointing to installed Playwright if not locally resolvable.
