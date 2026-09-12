'use client';

import {
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  LocateFixed,
  Navigation,
  Plane,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Aircraft = {
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

type ScanResult = {
  aircraft: Aircraft[];
  target: Aircraft | null;
  prediction: Prediction | null;
  trackedFlight: string | null;
  matchedCallsign: string | null;
  timestamp: number;
  remaining: string | null;
};

type Prediction = {
  status:
    | 'insufficient_data'
    | 'moving_away'
    | 'beyond_horizon'
    | 'overhead'
    | 'nearby'
    | 'off_course';
  etaMinutes: number | null;
  closestDistance: number | null;
  passTimestamp: number | null;
};

type Coordinates = { lat: number; lon: number };

type WebMcpContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

const STORAGE_KEY = 'overhead-display-location';
const DEFAULT_RADIUS = 35;
const GITHUB_PAGES_API =
  'https://overhead-aircraft-radar.wizardofozai.chatgpt.site/api/aircraft';

function aircraftApiUrl(params: URLSearchParams) {
  const endpoint = window.location.hostname.endsWith('github.io')
    ? GITHUB_PAGES_API
    : '/api/aircraft';
  return `${endpoint}?${params}`;
}

function formatAltitude(meters: number | null) {
  return meters === null
    ? '—'
    : `${Math.round(meters).toLocaleString('zh-CN')} m`;
}

function formatSpeed(metersPerSecond: number | null) {
  return metersPerSecond === null
    ? '—'
    : `${Math.round(metersPerSecond * 3.6)} km/h`;
}

function formatHeading(degrees: number | null) {
  if (degrees === null) return '—';
  const points = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return `${points[Math.round(degrees / 45) % 8]} · ${Math.round(degrees)}°`;
}

function formatClock(value: number | Date | null) {
  if (value === null) return '--:--';
  const date = value instanceof Date ? value : new Date(value * 1000);
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDate(date: Date | null) {
  if (!date) return '等待时间同步';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date);
}

function verticalLabel(rate: number | null) {
  if (rate === null || Math.abs(rate) < 0.2) return '平飞';
  return rate > 0 ? '爬升中' : '下降中';
}

function predictionTitle(prediction: Prediction | null) {
  if (!prediction) return '等待实时信号';
  if (prediction.status === 'moving_away') return '这架飞机正在远离';
  if (prediction.status === 'insufficient_data') return '航向数据暂不完整';
  if (prediction.status === 'beyond_horizon') return '预计经过时间较远';
  if (prediction.status === 'off_course') return '当前航迹不会飞近';
  return `${formatClock(prediction.passTimestamp)} 最接近你`;
}

function predictionDetail(prediction: Prediction | null) {
  if (!prediction) return '航班进入约 500 公里实时空域后显示';
  if (prediction.status === 'moving_away') return '可继续观察下一次实时更新';
  if (prediction.status === 'insufficient_data')
    return 'OpenSky 暂未提供足够的速度或航向';
  if (prediction.closestDistance === null) return '暂时无法估算最近距离';
  return `按当前航向估算，最近约 ${prediction.closestDistance.toFixed(1)} 公里`;
}

export default function Home() {
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [status, setStatus] = useState<
    'idle' | 'locating' | 'scanning' | 'ready' | 'error'
  >('idle');
  const [message, setMessage] = useState(
    '设置一次位置，这块电子纸就能持续显示头顶航班。',
  );
  const [now, setNow] = useState<Date | null>(null);
  const [trackedFlight, setTrackedFlight] = useState('');
  const [flightInput, setFlightInput] = useState('');

  const scan = useCallback(
    async (
      coords?: Coordinates,
      radiusOverride?: number,
      flightOverride?: string,
    ) => {
      const target = coords ?? position;
      if (!target) throw new Error('需要先设置显示位置。');
      const scanRadius = radiusOverride ?? radius;
      const flightCode = (flightOverride ?? trackedFlight)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      setPosition(target);
      setStatus('scanning');
      setMessage('正在读取附近空域…');

      try {
        const params = new URLSearchParams({
          lat: target.lat.toString(),
          lon: target.lon.toString(),
          radius: scanRadius.toString(),
        });
        if (flightCode) params.set('flight', flightCode);
        const response = await fetch(aircraftApiUrl(params));
        const payload: unknown = await response.json();
        if (!response.ok) {
          const errorPayload = payload as { error?: string };
          throw new Error(errorPayload.error || '暂时无法连接航班数据。');
        }

        const nextResult = payload as ScanResult;
        setResult(nextResult);
        setStatus('ready');
        if (flightCode && nextResult.target) {
          setMessage(`已找到 ${nextResult.target.callsign || flightCode}`);
        } else if (flightCode) {
          setMessage(`暂未在实时空域找到 ${flightCode}`);
        } else {
          setMessage(
            nextResult.aircraft.length
              ? `附近有 ${nextResult.aircraft.length} 架飞行中的飞机`
              : `${scanRadius} 公里内暂时没有收到飞机信号`,
          );
        }
        return nextResult;
      } catch (error) {
        setStatus('error');
        setMessage(
          error instanceof Error ? error.message : '查询失败，请稍后重试。',
        );
        throw error;
      }
    },
    [position, radius, trackedFlight],
  );

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('error');
      setMessage('当前浏览器不支持定位。');
      return;
    }

    setStatus('locating');
    setMessage('正在获取这块屏幕所在的位置…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const next = {
          lat: Math.round(coords.latitude * 1000) / 1000,
          lon: Math.round(coords.longitude * 1000) / 1000,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        const url = new URL(window.location.href);
        url.searchParams.set('lat', next.lat.toString());
        url.searchParams.set('lon', next.lon.toString());
        url.searchParams.set('radius', radius.toString());
        window.history.replaceState({}, '', url);
        void scan(next).catch(() => undefined);
      },
      (error) => {
        setStatus('error');
        setMessage(
          error.code === error.PERMISSION_DENIED
            ? '定位权限被拒绝，请开启位置权限后重试。'
            : '无法确定位置，请检查系统定位服务。',
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 },
    );
  }, [radius, scan]);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    const params = new URLSearchParams(window.location.search);
    const latParam = params.get('lat');
    const lonParam = params.get('lon');
    const radiusParam = params.get('radius');
    const queryFlight = (params.get('flight') ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const queryLat = latParam === null ? Number.NaN : Number(latParam);
    const queryLon = lonParam === null ? Number.NaN : Number(lonParam);
    const queryRadius = radiusParam === null ? Number.NaN : Number(radiusParam);
    let initial: Coordinates | null = null;

    if (
      Number.isFinite(queryLat) &&
      Number.isFinite(queryLon) &&
      queryLat >= -90 &&
      queryLat <= 90 &&
      queryLon >= -180 &&
      queryLon <= 180
    ) {
      initial = { lat: queryLat, lon: queryLon };
    } else {
      try {
        const stored = JSON.parse(
          localStorage.getItem(STORAGE_KEY) || 'null',
        ) as Coordinates | null;
        if (
          stored &&
          Number.isFinite(stored.lat) &&
          Number.isFinite(stored.lon)
        )
          initial = stored;
      } catch {
        // Ignore malformed local preferences.
      }
    }

    const initialRadius =
      Number.isFinite(queryRadius) && queryRadius >= 10 && queryRadius <= 50
        ? queryRadius
        : DEFAULT_RADIUS;
    setRadius(initialRadius);
    setTrackedFlight(queryFlight);
    setFlightInput(queryFlight);
    if (initial)
      void scan(initial, initialRadius, queryFlight).catch(() => undefined);
    return () => window.clearInterval(timer);
    // The initial URL and saved location are intentionally read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!position) return;
    const timer = window.setInterval(
      () => {
        void scan().catch(() => undefined);
      },
      15 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [position, scan]);

  useEffect(() => {
    const modelContext = (
      document as Document & { modelContext?: WebMcpContext }
    ).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(
      modelContext.registerTool(
        {
          name: 'scan_nearby_aircraft',
          title: '更新电子纸航班画面',
          description: '用指定经纬度更新电子纸画面上的附近航班。',
          inputSchema: {
            type: 'object',
            properties: {
              latitude: { type: 'number', minimum: -90, maximum: 90 },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
              radiusKm: { type: 'number', minimum: 10, maximum: 50 },
              flightNumber: {
                type: 'string',
                description: '可选航班号，例如 MU5123',
              },
            },
            required: ['latitude', 'longitude'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          async execute(input) {
            const value = input as {
              latitude?: unknown;
              longitude?: unknown;
              radiusKm?: unknown;
              flightNumber?: unknown;
            };
            const latitude = Number(value.latitude);
            const longitude = Number(value.longitude);
            const radiusKm =
              value.radiusKm === undefined
                ? DEFAULT_RADIUS
                : Number(value.radiusKm);
            if (
              !Number.isFinite(latitude) ||
              latitude < -90 ||
              latitude > 90 ||
              !Number.isFinite(longitude) ||
              longitude < -180 ||
              longitude > 180 ||
              !Number.isFinite(radiusKm) ||
              radiusKm < 10 ||
              radiusKm > 50
            ) {
              throw new Error('经纬度或搜索半径无效。');
            }
            setRadius(radiusKm);
            const flightNumber =
              typeof value.flightNumber === 'string'
                ? value.flightNumber.toUpperCase().replace(/[^A-Z0-9]/g, '')
                : '';
            setTrackedFlight(flightNumber);
            setFlightInput(flightNumber);
            const next = await scan(
              { lat: latitude, lon: longitude },
              radiusKm,
              flightNumber,
            );
            return {
              count: next.aircraft.length,
              trackedFlight: next.trackedFlight,
              prediction: next.prediction,
              nearest: next.aircraft[0]
                ? {
                    callsign: next.aircraft[0].callsign,
                    distanceKm: Number(next.aircraft[0].distance.toFixed(1)),
                  }
                : null,
              updatedAt: next.timestamp,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, [scan]);

  const featured = result?.target ?? result?.aircraft[0] ?? null;
  const flights = useMemo(() => result?.aircraft.slice(0, 5) ?? [], [result]);
  const plottedFlights = useMemo(() => {
    const candidates = result?.target
      ? [result.target, ...(result.aircraft ?? [])]
      : (result?.aircraft ?? []);
    return candidates
      .filter(
        (flight, index, list) =>
          list.findIndex((item) => item.icao24 === flight.icao24) === index,
      )
      .slice(0, 5);
  }, [result]);
  const isBusy = status === 'locating' || status === 'scanning';

  const trackFlight = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = flightInput.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setFlightInput(code);
    setTrackedFlight(code);
    const url = new URL(window.location.href);
    if (code) url.searchParams.set('flight', code);
    else url.searchParams.delete('flight');
    window.history.replaceState({}, '', url);
    if (!position) {
      setMessage('请先设置显示位置，再追踪这趟航班。');
      return;
    }
    void scan(position, radius, code).catch(() => undefined);
  };

  return (
    <main className="epaper-page">
      <section
        className="epaper-stage"
        aria-label="reTerminal E1004 头顶航班画面"
      >
        <img
          className="art-background"
          src="epaper-background.png"
          alt="仰望天空的奇幻角色插画"
        />
        <div className="sky-wash" aria-hidden="true" />

        <header className="display-header">
          <div className="display-title">
            <Plane aria-hidden="true" />
            <div>
              <span>OVERHEAD</span>
              <strong>头顶航班</strong>
            </div>
          </div>
          <div className="date-block">
            <strong>{formatClock(result?.timestamp ?? now)}</strong>
            <span>{formatDate(now)}</span>
          </div>
        </header>

        {plottedFlights.map((flight, index) => {
          const isTarget = result?.target?.icao24 === flight.icao24;
          const spread = Math.min(
            flight.distance / (isTarget ? Math.max(radius, 120) : radius),
            1,
          );
          const angle = (flight.bearing * Math.PI) / 180;
          const left = 50 + Math.sin(angle) * spread * 39;
          const top = 27 - Math.cos(angle) * spread * 17;
          return (
            <div
              className={`sky-plane sky-plane-${Math.min(index, 3)} ${isTarget ? 'is-target' : ''}`}
              key={flight.icao24}
              style={{
                left: `${left}%`,
                top: `${Math.max(10, Math.min(46, top))}%`,
              }}
            >
              <Plane
                aria-hidden="true"
                style={{ transform: `rotate(${flight.track ?? 0}deg)` }}
              />
              <span>{flight.callsign || flight.icao24.toUpperCase()}</span>
            </div>
          );
        })}

        <section className="hero-card" aria-live="polite">
          <p className="kicker">
            {result?.target
              ? 'TRACKED FLIGHT · 追踪航班'
              : 'NEAREST AIRCRAFT · 最近'}
          </p>
          {featured ? (
            <>
              <div className="flight-name-row">
                <h1>{featured.callsign || featured.icao24.toUpperCase()}</h1>
                <span>{featured.distance.toFixed(1)} km</span>
              </div>
              <p className="flight-origin">
                {featured.country} · ICAO {featured.icao24.toUpperCase()}
              </p>
              <dl className="primary-stats">
                <div>
                  <dt>飞行高度</dt>
                  <dd>{formatAltitude(featured.altitude)}</dd>
                </div>
                <div>
                  <dt>地面速度</dt>
                  <dd>{formatSpeed(featured.velocity)}</dd>
                </div>
                <div>
                  <dt>当前航向</dt>
                  <dd>{formatHeading(featured.track)}</dd>
                </div>
                <div>
                  <dt>
                    {(featured.verticalRate ?? 0) < 0 ? (
                      <ArrowDownRight aria-hidden="true" />
                    ) : (
                      <ArrowUpRight aria-hidden="true" />
                    )}{' '}
                    飞行状态
                  </dt>
                  <dd>{verticalLabel(featured.verticalRate)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="quiet-state">
              <h1>{position && result ? '天空很安静' : '等待定位'}</h1>
              <p>{message}</p>
              {!position && (
                <Button
                  className="setup-button"
                  onClick={locate}
                  disabled={isBusy}
                >
                  {isBusy ? (
                    <RefreshCw className="spin" aria-hidden="true" />
                  ) : (
                    <LocateFixed aria-hidden="true" />
                  )}
                  {isBusy ? '正在定位' : '设置显示位置'}
                </Button>
              )}
            </div>
          )}
        </section>

        <form className="flight-search-card" onSubmit={trackFlight}>
          <label htmlFor="flight-number">追踪航班</label>
          <div className="flight-search-row">
            <Input
              id="flight-number"
              value={flightInput}
              onChange={(event) => setFlightInput(event.target.value)}
              placeholder="例如 MU5123"
              autoComplete="off"
              maxLength={10}
              aria-label="输入航班号"
            />
            <Button type="submit" disabled={isBusy} aria-label="查询航班">
              {isBusy ? (
                <RefreshCw className="spin" aria-hidden="true" />
              ) : (
                <Search aria-hidden="true" />
              )}
            </Button>
          </div>
          {trackedFlight && (
            <div className="flight-prediction" aria-live="polite">
              <span>
                {result?.target?.callsign || trackedFlight}
                {result?.target && result.target.callsign !== trackedFlight
                  ? ` · ${trackedFlight}`
                  : ''}
              </span>
              <strong>
                {result?.target
                  ? predictionTitle(result.prediction)
                  : '暂未收到该航班'}
              </strong>
              <small>
                {result?.target
                  ? predictionDetail(result.prediction)
                  : '可能尚未起飞，或不在约 500 公里实时覆盖内'}
              </small>
            </div>
          )}
          <p>按当前速度和航向直线估算，不是航司计划时间</p>
        </form>

        <aside className="airspace-note">
          <Navigation aria-hidden="true" />
          <div>
            <span>扫描范围</span>
            <strong>{radius} 公里</strong>
          </div>
        </aside>

        <section className="flight-strip" aria-label="附近航班列表">
          <div className="strip-intro">
            <span
              className={`signal-dot ${status === 'ready' ? 'is-ready' : ''}`}
            />
            <div>
              <strong>{message}</strong>
              <span>
                OpenSky · {formatClock(result?.timestamp ?? null)} 更新
              </span>
            </div>
          </div>
          <div className="mini-flights">
            {flights.slice(1, 5).map((flight) => (
              <div className="mini-flight" key={flight.icao24}>
                <Plane
                  aria-hidden="true"
                  style={{ transform: `rotate(${flight.track ?? 0}deg)` }}
                />
                <div>
                  <strong>
                    {flight.callsign || flight.icao24.toUpperCase()}
                  </strong>
                  <span>
                    {flight.distance.toFixed(1)} km ·{' '}
                    {formatAltitude(flight.altitude)}
                  </span>
                </div>
              </div>
            ))}
            {flights.length <= 1 && (
              <p className="no-more-flights">下一架飞机出现时，会显示在这里</p>
            )}
          </div>
          {position && (
            <Button
              className="refresh-button"
              variant="outline"
              size="sm"
              onClick={() => void scan().catch(() => undefined)}
              disabled={isBusy}
            >
              <RefreshCw className={isBusy ? 'spin' : ''} aria-hidden="true" />{' '}
              更新
            </Button>
          )}
        </section>

        <footer className="display-footer">
          <span>reTerminal E1004 · 1600 × 1200 横向画面</span>
          <span>航班数据可能延迟或存在覆盖盲区，请勿用于飞行安全决策</span>
        </footer>
      </section>
    </main>
  );
}
