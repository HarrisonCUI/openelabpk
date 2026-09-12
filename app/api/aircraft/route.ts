type OpenSkyState = [
  string,
  string | null,
  string,
  number | null,
  number,
  number | null,
  number | null,
  number | null,
  boolean,
  number | null,
  number | null,
  number | null,
  number[] | null,
  number | null,
  string | null,
  boolean,
  number,
  number?,
];

type OpenSkyResponse = { time: number; states: OpenSkyState[] | null };

type AdsbLolAircraft = {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
};

type AdsbLolResponse = {
  ac?: AdsbLolAircraft[];
  now?: number;
};

type NormalizedAircraft = {
  icao24: string;
  callsign: string | null;
  country: string;
  longitude: number;
  latitude: number;
  altitude: number | null;
  velocity: number | null;
  track: number | null;
  verticalRate: number | null;
  category: number | null;
  distance: number;
  bearing: number;
};

const responseCache = new Map<string, { expires: number; body: string }>();
const SHENZHEN_FALLBACK = { lat: 22.5431, lon: 114.0579 };
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const airlinePrefixes: Record<string, string> = {
  MU: 'CES',
  CA: 'CCA',
  CZ: 'CSN',
  HU: 'CHH',
  MF: 'CXA',
  ZH: 'CSZ',
  FM: 'CSH',
  '3U': 'CSC',
  '9C': 'CQH',
  SC: 'CDG',
  JD: 'CBJ',
  GS: 'GCR',
  KN: 'CUA',
  HO: 'DKH',
  PN: 'CHB',
  UA: 'UAL',
  AA: 'AAL',
  DL: 'DAL',
  BA: 'BAW',
  EK: 'UAE',
  SQ: 'SIA',
  CX: 'CPA',
  LH: 'DLH',
  AF: 'AFR',
  KL: 'KLM',
  JL: 'JAL',
  NH: 'ANA',
  KE: 'KAL',
  QR: 'QTR',
  TK: 'THY',
};

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceAndBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
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
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return { distance, bearing: (bearing + 360) % 360 };
}

function flightCallsigns(input: string) {
  const normalized = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const mapped = airlinePrefixes[normalized.slice(0, 2)];
  return {
    normalized,
    alternatives: mapped
      ? [normalized, `${mapped}${normalized.slice(2)}`]
      : [normalized],
  };
}

function closestApproach(
  observerLat: number,
  observerLon: number,
  aircraft: {
    latitude: number;
    longitude: number;
    distance: number;
    velocity: number | null;
    track: number | null;
  },
  timestamp: number,
) {
  if (
    aircraft.velocity === null ||
    aircraft.track === null ||
    aircraft.velocity < 20
  ) {
    return {
      status: 'insufficient_data',
      etaMinutes: null,
      closestDistance: null,
      passTimestamp: null,
    };
  }

  const meanLat = toRadians((observerLat + aircraft.latitude) / 2);
  const east = (aircraft.longitude - observerLon) * 111.32 * Math.cos(meanLat);
  const north = (aircraft.latitude - observerLat) * 110.57;
  const speed = aircraft.velocity * 3.6;
  const track = toRadians(aircraft.track);
  const velocityEast = speed * Math.sin(track);
  const velocityNorth = speed * Math.cos(track);
  const timeHours =
    -(east * velocityEast + north * velocityNorth) /
    (velocityEast ** 2 + velocityNorth ** 2);

  if (timeHours < 0) {
    return {
      status: 'moving_away',
      etaMinutes: null,
      closestDistance: aircraft.distance,
      passTimestamp: null,
    };
  }

  const closestEast = east + velocityEast * timeHours;
  const closestNorth = north + velocityNorth * timeHours;
  const closestDistance = Math.sqrt(closestEast ** 2 + closestNorth ** 2);
  const etaMinutes = Math.round(timeHours * 60);
  const status =
    timeHours > 1.5
      ? 'beyond_horizon'
      : closestDistance <= 10
        ? 'overhead'
        : closestDistance <= 35
          ? 'nearby'
          : 'off_course';

  return {
    status,
    etaMinutes,
    closestDistance,
    passTimestamp: Math.round(timestamp + timeHours * 3600),
  };
}

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...headers,
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));
  const radius = Number(searchParams.get('radius') ?? 25);
  const requestedFlight = searchParams.get('flight')?.trim() ?? '';
  const flight = requestedFlight ? flightCallsigns(requestedFlight) : null;

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(radius)
  ) {
    return json({ error: '位置参数无效，请重新定位。' }, 400);
  }
  if (
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180 ||
    radius < 10 ||
    radius > 50
  ) {
    return json({ error: '位置或搜索半径超出允许范围。' }, 400);
  }
  if (
    flight &&
    (flight.normalized.length < 2 || flight.normalized.length > 10)
  ) {
    return json({ error: '航班号格式无效。' }, 400);
  }

  const roundedLat = Math.round(lat * 100) / 100;
  const roundedLon = Math.round(lon * 100) / 100;
  const cacheKey = `${roundedLat}:${roundedLon}:${radius}:${flight?.normalized ?? ''}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return new Response(cached.body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=10',
        'x-data-cache': 'HIT',
        ...corsHeaders,
      },
    });
  }

  const searchRadius = flight ? 250 : radius;
  const latDelta = searchRadius / 111;
  const lonDelta =
    searchRadius / Math.max(111 * Math.cos(toRadians(roundedLat)), 10);
  const params = new URLSearchParams({
    lamin: Math.max(-90, roundedLat - latDelta).toFixed(4),
    lomin: Math.max(-180, roundedLon - lonDelta).toFixed(4),
    lamax: Math.min(90, roundedLat + latDelta).toFixed(4),
    lomax: Math.min(180, roundedLon + lonDelta).toFixed(4),
    extended: '1',
  });

  let dataTime = Math.floor(Date.now() / 1000);
  let remaining: string | null = null;
  let source = 'OpenSky';
  let allAircraft: NormalizedAircraft[] = [];

  try {
    const upstream = await fetch(
      `https://opensky-network.org/api/states/all?${params}`,
      {
        headers: {
          accept: 'application/json',
          'user-agent': 'Overhead-Aircraft-Radar/1.0',
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!upstream.ok) throw new Error(`OpenSky ${upstream.status}`);

    const data = (await upstream.json()) as OpenSkyResponse;
    dataTime = data.time;
    remaining = upstream.headers.get('x-rate-limit-remaining');
    allAircraft = (data.states ?? [])
      .filter((state) => state[5] !== null && state[6] !== null && !state[8])
      .map((state) => {
        const longitude = state[5] as number;
        const latitude = state[6] as number;
        const position = distanceAndBearing(lat, lon, latitude, longitude);
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
      });
  } catch {
    const isShenzhenFallback =
      Math.abs(lat - SHENZHEN_FALLBACK.lat) < 0.000_001 &&
      Math.abs(lon - SHENZHEN_FALLBACK.lon) < 0.000_001;
    if (!isShenzhenFallback) {
      return json({ error: '暂时连接不上 OpenSky，请稍后再试。' }, 502);
    }

    try {
      const nauticalMiles = Math.min(250, Math.ceil(searchRadius / 1.852));
      const fallback = await fetch(
        `https://api.adsb.lol/v2/point/${SHENZHEN_FALLBACK.lat}/${SHENZHEN_FALLBACK.lon}/${nauticalMiles}`,
        {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (!fallback.ok) throw new Error(`ADSB.lol ${fallback.status}`);

      const data = (await fallback.json()) as AdsbLolResponse;
      dataTime = data.now ? Math.floor(data.now / 1000) : dataTime;
      source = 'ADSB.lol · 深圳兜底';
      allAircraft = (data.ac ?? [])
        .filter(
          (item) =>
            typeof item.lat === 'number' &&
            typeof item.lon === 'number' &&
            item.alt_baro !== 'ground',
        )
        .map((item) => {
          const latitude = item.lat as number;
          const longitude = item.lon as number;
          const position = distanceAndBearing(lat, lon, latitude, longitude);
          const altitudeFeet =
            typeof item.alt_geom === 'number'
              ? item.alt_geom
              : typeof item.alt_baro === 'number'
                ? item.alt_baro
                : null;
          return {
            icao24: item.hex ?? 'unknown',
            callsign: item.flight?.trim() || null,
            country: '实时 ADS-B',
            longitude,
            latitude,
            altitude: altitudeFeet === null ? null : altitudeFeet * 0.3048,
            velocity: typeof item.gs === 'number' ? item.gs * 0.514_444 : null,
            track: typeof item.track === 'number' ? item.track : null,
            verticalRate:
              typeof item.baro_rate === 'number'
                ? item.baro_rate * 0.005_08
                : null,
            category: null,
            distance: position.distance,
            bearing: position.bearing,
          };
        });
    } catch {
      return json({ error: '深圳实时航班数据暂时不可用，请稍后重试。' }, 502);
    }
  }
  const aircraft = allAircraft
    .filter((item) => item.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
  const target = flight
    ? (allAircraft.find(
        (item) =>
          item.callsign &&
          flight.alternatives.includes(item.callsign.toUpperCase()),
      ) ?? null)
    : null;
  const prediction = target
    ? closestApproach(lat, lon, target, dataTime)
    : null;

  const body = JSON.stringify({
    aircraft,
    target,
    prediction,
    trackedFlight: flight?.normalized ?? null,
    matchedCallsign: target?.callsign ?? null,
    timestamp: dataTime,
    remaining,
    source,
  });
  responseCache.set(cacheKey, { body, expires: Date.now() + 20_000 });

  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=10',
      'x-data-cache': 'MISS',
      ...corsHeaders,
    },
  });
}
