# Design QA

- Source visual truth path: `/var/folders/p_/3p3yfg4j69l5lglxzy8m6lqh0000gn/T/codex-clipboard-35f21ce8-5e6c-4b71-b86e-e6446705aba3.png`
- Implementation screenshot path: browser capture attached inline to this Codex task (CUA tab 5; the browser tool does not expose a filesystem path)
- Viewport: 1600 × 1200 CSS pixels
- Source dimensions: 1586 × 992 pixels
- Implementation dimensions: 1600 × 1200 pixels at device pixel ratio 1
- Density normalization: none required; both were inspected at native raster density
- State: Tokyo sample location, tracked flight `JL259`, successful OpenSky match to `JAL259`

## Full-view comparison evidence

The supplied illustration is used unmodified and remains the dominant visual. Its centered face and upward gaze are preserved in the 4:3 E1004 crop. High-contrast paper cards occupy the open sky at the left and right edges; the face remains unobstructed. The bottom status strip overlaps only the lower torso area. The palette is derived from the source image: deep sky blue, warm paper white, sunlight yellow, and a restrained coral action color.

## Focused region comparison evidence

- Left aircraft card: large callsign, compact distance flag, and four bordered telemetry cells remain readable at e-paper viewing distance.
- Right search card: label, input, search action, matched callsign, and pass-status message form one clear vertical task flow.
- Bottom strip: nearby aircraft stay secondary and do not compete with the tracked-flight result.
- Background: exact source checksum was preserved after copying; no generated or placeholder imagery is present.

## Findings

No actionable P0, P1, or P2 issues remain.

- Fonts and typography: Chinese and Latin fallback stacks are explicit; headline, telemetry, and helper text have distinct optical hierarchy and do not wrap unexpectedly at 1600 × 1200.
- Spacing and layout rhythm: the asymmetric edge cards preserve a clean central viewing corridor around the character's face.
- Colors and visual tokens: paper-white cards and dark navy borders retain contrast without washing out the illustration.
- Image quality and asset fidelity: the user-supplied 1586 × 992 PNG is used directly. The expected side crop adapts the wider source to the E1004 4:3 landscape frame while retaining the focal subject.
- Copy and content: the interface distinguishes real-time observation from straight-line prediction and clearly states that it is not an airline schedule.
- Interaction: location loading, nearby-aircraft results, flight-number submission, IATA-to-ICAO callsign matching, tracked state, URL persistence, refresh, empty state, and error copy were checked. Browser console warnings/errors: none.

## Comparison history

1. Initial busy-airspace capture showed five aircraft labels overlapping above the character (P2 readability issue).
2. Fixed by retaining one spatial marker for the featured aircraft and moving the remaining aircraft to the structured bottom list.
3. Post-fix capture shows one highlighted marker, a clear tracked-flight card, and no competing labels.

## Follow-up polish

- P3: the wide source image necessarily loses a small amount at both side edges in the 4:3 device crop; the focal character and all important visual content remain intact.

## Implementation checklist

- [x] Exact replacement background installed
- [x] E1004 1600 × 1200 layout verified
- [x] Flight input and prediction states verified
- [x] Busy-airspace label collision fixed
- [x] Static GitHub Pages build verified
- [x] Console errors checked

final result: passed
