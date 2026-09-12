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

const responseCache = new Map<string, { expires: number; body: string }>();

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

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));
  const radius = Number(searchParams.get('radius') ?? 25);

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

  const roundedLat = Math.round(lat * 100) / 100;
  const roundedLon = Math.round(lon * 100) / 100;
  const cacheKey = `${roundedLat}:${roundedLon}:${radius}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return new Response(cached.body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=10',
        'x-data-cache': 'HIT',
      },
    });
  }

  const latDelta = radius / 111;
  const lonDelta = radius / Math.max(111 * Math.cos(toRadians(roundedLat)), 10);
  const params = new URLSearchParams({
    lamin: Math.max(-90, roundedLat - latDelta).toFixed(4),
    lomin: Math.max(-180, roundedLon - lonDelta).toFixed(4),
    lamax: Math.min(90, roundedLat + latDelta).toFixed(4),
    lomax: Math.min(180, roundedLon + lonDelta).toFixed(4),
    extended: '1',
  });

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://opensky-network.org/api/states/all?${params}`,
      {
        headers: {
          accept: 'application/json',
          'user-agent': 'Overhead-Aircraft-Radar/1.0',
        },
      },
    );
  } catch {
    return json({ error: '暂时连接不上 OpenSky，请稍后再试。' }, 502);
  }

  if (!upstream.ok) {
    if (upstream.status === 429) {
      const retry = upstream.headers.get('x-rate-limit-retry-after-seconds');
      const hours =
        retry && Number.isFinite(Number(retry))
          ? Math.max(1, Math.ceil(Number(retry) / 3600))
          : null;
      return json(
        {
          error: hours
            ? `OpenSky 今日查询额度已用完，请约 ${hours} 小时后再试。`
            : 'OpenSky 查询繁忙，请稍后再试。',
        },
        429,
      );
    }
    return json(
      { error: `OpenSky 暂时不可用（${upstream.status}），请稍后重试。` },
      502,
    );
  }

  const data = (await upstream.json()) as OpenSkyResponse;
  const aircraft = (data.states ?? [])
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
    })
    .filter((item) => item.distance <= radius)
    .sort((a, b) => a.distance - b.distance);

  const body = JSON.stringify({
    aircraft,
    timestamp: data.time,
    remaining: upstream.headers.get('x-rate-limit-remaining'),
  });
  responseCache.set(cacheKey, { body, expires: Date.now() + 20_000 });

  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=10',
      'x-data-cache': 'MISS',
    },
  });
}
