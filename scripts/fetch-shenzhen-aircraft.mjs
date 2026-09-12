import { writeFile } from 'node:fs/promises';

const outputPath = process.argv[2];
if (!outputPath) throw new Error('Missing output path.');

const center = { lat: 22.5431, lon: 114.0579 };
const radius = 35;
const toRadians = (value) => (value * Math.PI) / 180;

function distanceAndBearing(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371;
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const distance = earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return {
    distance,
    bearing: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
  };
}

const latDelta = radius / 111;
const lonDelta = radius / (111 * Math.cos(toRadians(center.lat)));
const query = new URLSearchParams({
  lamin: (center.lat - latDelta).toFixed(4),
  lomin: (center.lon - lonDelta).toFixed(4),
  lamax: (center.lat + latDelta).toFixed(4),
  lomax: (center.lon + lonDelta).toFixed(4),
  extended: '1',
});

const response = await fetch(
  `https://opensky-network.org/api/states/all?${query}`,
  { signal: AbortSignal.timeout(30_000) },
);
if (!response.ok) throw new Error(`OpenSky returned ${response.status}.`);

const data = await response.json();
const aircraft = (data.states ?? [])
  .filter((state) => state[5] !== null && state[6] !== null && !state[8])
  .map((state) => {
    const longitude = state[5];
    const latitude = state[6];
    const position = distanceAndBearing(
      center.lat,
      center.lon,
      latitude,
      longitude,
    );
    return {
      icao24: state[0],
      callsign: state[1]?.trim() || null,
      country: state[2],
      longitude,
      latitude,
      altitude: state[13] ?? state[7],
      velocity: state[9],
      track: state[10],
      verticalRate: state[11],
      category: state[17] ?? null,
      distance: position.distance,
      bearing: position.bearing,
    };
  })
  .filter((item) => item.distance <= radius)
  .sort((a, b) => a.distance - b.distance);

await writeFile(
  outputPath,
  `${JSON.stringify({
    aircraft,
    target: null,
    prediction: null,
    trackedFlight: null,
    matchedCallsign: null,
    timestamp: data.time,
    remaining: response.headers.get('x-rate-limit-remaining'),
    source: 'OpenSky · GitHub 深圳快照',
  })}\n`,
);
