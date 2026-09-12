'use client';

import {
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Crosshair,
  ExternalLink,
  Gauge,
  LocateFixed,
  MapPin,
  Navigation,
  Plane,
  Radio,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

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
  timestamp: number;
  remaining: string | null;
};

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

const categoryNames: Record<number, string> = {
  2: '轻型飞机',
  3: '小型飞机',
  4: '大型飞机',
  5: '大型飞机',
  6: '重型飞机',
  7: '高性能飞机',
  8: '直升机',
  9: '滑翔机',
  10: '轻于空气航空器',
  11: '跳伞者',
  12: '超轻型飞机',
  14: '无人机',
};

function formatAltitude(meters: number | null) {
  if (meters === null) return '高度未知';
  return `${Math.round(meters).toLocaleString('zh-CN')} m`;
}

function formatSpeed(metersPerSecond: number | null) {
  if (metersPerSecond === null) return '—';
  return `${Math.round(metersPerSecond * 3.6)} km/h`;
}

function formatTime(timestamp: number | null) {
  if (!timestamp) return '尚未扫描';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

function compass(degrees: number | null) {
  if (degrees === null) return '—';
  const points = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return `${points[Math.round(degrees / 45) % 8]} ${Math.round(degrees)}°`;
}

function RadarScope({
  aircraft,
  selected,
  radius,
  onSelect,
}: {
  aircraft: Aircraft[];
  selected: string | null;
  radius: number;
  onSelect: (icao24: string) => void;
}) {
  return (
    <div className="radar-shell" aria-label={`半径 ${radius} 公里的雷达视图`}>
      <div className="radar-grid" />
      <div className="radar-sweep" />
      <span className="radar-axis radar-axis-x" />
      <span className="radar-axis radar-axis-y" />
      <span className="radar-label radar-north">N</span>
      <span className="radar-label radar-east">E</span>
      <span className="radar-label radar-south">S</span>
      <span className="radar-label radar-west">W</span>
      <span className="range-label range-label-inner">
        {Math.round(radius / 2)} km
      </span>
      <span className="range-label range-label-outer">{radius} km</span>

      {aircraft.map((plane) => {
        const radial = Math.min(plane.distance / radius, 1) * 45;
        const angle = (plane.bearing * Math.PI) / 180;
        const left = 50 + Math.sin(angle) * radial;
        const top = 50 - Math.cos(angle) * radial;
        const isSelected = selected === plane.icao24;

        return (
          <button
            type="button"
            className={`aircraft-dot${isSelected ? ' is-selected' : ''}`}
            key={plane.icao24}
            style={{ left: `${left}%`, top: `${top}%` }}
            onClick={() => onSelect(plane.icao24)}
            aria-label={`${plane.callsign || plane.icao24}，距离 ${plane.distance.toFixed(1)} 公里`}
          >
            <Plane
              aria-hidden="true"
              style={{ transform: `rotate(${plane.track ?? 0}deg)` }}
            />
            <span>{plane.callsign || plane.icao24.toUpperCase()}</span>
          </button>
        );
      })}

      <div className="you-are-here" aria-label="你的位置">
        <span />
        <i />
      </div>
    </div>
  );
}

export default function Home() {
  const [radius, setRadius] = useState(25);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(
    null,
  );
  const [status, setStatus] = useState<
    'idle' | 'locating' | 'scanning' | 'ready' | 'error'
  >('idle');
  const [message, setMessage] = useState(
    '允许定位后，雷达会查找你附近正在飞行的飞机。',
  );

  const scan = useCallback(
    async (coords?: { lat: number; lon: number }, radiusOverride?: number) => {
      const target = coords ?? position;
      if (!target) throw new Error('需要先提供位置。');
      const scanRadius = radiusOverride ?? radius;
      setPosition(target);
      setStatus('scanning');
      setMessage('正在接收附近的实时广播…');

      try {
        const params = new URLSearchParams({
          lat: target.lat.toString(),
          lon: target.lon.toString(),
          radius: scanRadius.toString(),
        });
        const response = await fetch(`/api/aircraft?${params}`);
        const payload: unknown = await response.json();
        if (!response.ok) {
          const errorPayload = payload as { error?: string };
          throw new Error(errorPayload.error || '暂时无法连接航班数据。');
        }

        const nextResult = payload as ScanResult;
        setResult(nextResult);
        setSelectedId(nextResult.aircraft[0]?.icao24 ?? null);
        setStatus('ready');
        setMessage(
          nextResult.aircraft.length
            ? `找到 ${nextResult.aircraft.length} 架飞行中的飞机，已按距离排序。`
            : `半径 ${scanRadius} 公里内暂时没有收到飞行中的飞机。`,
        );
        return nextResult;
      } catch (error) {
        setStatus('error');
        setMessage(
          error instanceof Error ? error.message : '扫描失败，请稍后重试。',
        );
        throw error;
      }
    },
    [position, radius],
  );

  const locateAndScan = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('error');
      setMessage('这个浏览器不支持定位，请换用较新的浏览器。');
      return;
    }

    setStatus('locating');
    setMessage('正在获取你的位置…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const next = { lat: coords.latitude, lon: coords.longitude };
        setPosition(next);
        void scan(next).catch(() => undefined);
      },
      (error) => {
        setStatus('error');
        setMessage(
          error.code === error.PERMISSION_DENIED
            ? '定位权限被拒绝。请在浏览器地址栏旁开启位置权限后重试。'
            : '无法确定位置，请检查系统定位服务后重试。',
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }, [scan]);

  const selected = useMemo(
    () =>
      result?.aircraft.find((item) => item.icao24 === selectedId) ??
      result?.aircraft[0] ??
      null,
    [result, selectedId],
  );
  const isBusy = status === 'locating' || status === 'scanning';

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
          title: '扫描附近飞机',
          description:
            '用给定经纬度和半径扫描附近正在飞行的飞机，并把结果显示在雷达上。',
          inputSchema: {
            type: 'object',
            properties: {
              latitude: { type: 'number', minimum: -90, maximum: 90 },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
              radiusKm: {
                type: 'number',
                minimum: 10,
                maximum: 50,
                multipleOf: 5,
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
            };
            const latitude = Number(value.latitude);
            const longitude = Number(value.longitude);
            const radiusKm =
              value.radiusKm === undefined ? 25 : Number(value.radiusKm);
            if (
              !Number.isFinite(latitude) ||
              latitude < -90 ||
              latitude > 90 ||
              !Number.isFinite(longitude) ||
              longitude < -180 ||
              longitude > 180 ||
              !Number.isFinite(radiusKm) ||
              radiusKm < 10 ||
              radiusKm > 50 ||
              radiusKm % 5 !== 0
            ) {
              throw new Error(
                '经纬度或半径无效。半径必须是 10–50 公里之间的 5 公里倍数。',
              );
            }
            setRadius(radiusKm);
            const scanResult = await scan(
              { lat: latitude, lon: longitude },
              radiusKm,
            );
            return {
              count: scanResult.aircraft.length,
              nearest: scanResult.aircraft[0]
                ? {
                    callsign: scanResult.aircraft[0].callsign,
                    distanceKm: Number(
                      scanResult.aircraft[0].distance.toFixed(1),
                    ),
                  }
                : null,
              updatedAt: scanResult.timestamp,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, [scan]);

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="site-noise" aria-hidden="true" />
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Radio aria-hidden="true" />
          </span>
          <div>
            <p>OVERHEAD / LIVE</p>
            <h1>头顶航班雷达</h1>
          </div>
        </div>
        <div className="live-status" aria-label="实时数据状态">
          <span className={status === 'ready' ? 'is-live' : ''} />
          {status === 'ready' ? '数据已更新' : '等待定位'}
        </div>
      </header>

      <section className="workspace">
        <aside className="control-panel">
          <div className="eyebrow">
            <Crosshair aria-hidden="true" /> 扫描设置
          </div>
          <h2>
            看看此刻，
            <br />
            谁正从你头顶飞过。
          </h2>
          <p className="intro">
            用当前位置查询附近飞机的实时广播信号。位置只用于本次查询，不会保存。
          </p>

          <div className="range-control">
            <div className="range-heading">
              <label htmlFor="radius-slider">搜索半径</label>
              <output>{radius} km</output>
            </div>
            <Slider
              id="radius-slider"
              min={10}
              max={50}
              step={5}
              value={[radius]}
              onValueChange={(value) =>
                setRadius(Array.isArray(value) ? value[0] : Number(value))
              }
              aria-label="搜索半径"
            />
            <div className="range-scale">
              <span>10 km</span>
              <span>50 km</span>
            </div>
          </div>

          <Button
            className="locate-button"
            size="lg"
            onClick={
              position
                ? () => void scan().catch(() => undefined)
                : locateAndScan
            }
            disabled={isBusy}
          >
            {isBusy ? (
              <RefreshCw className="animate-spin" aria-hidden="true" />
            ) : position ? (
              <RefreshCw aria-hidden="true" />
            ) : (
              <LocateFixed aria-hidden="true" />
            )}
            {status === 'locating'
              ? '正在定位'
              : status === 'scanning'
                ? '正在扫描'
                : position
                  ? '重新扫描'
                  : '定位并扫描'}
          </Button>

          <div
            className={`status-message status-${status}`}
            role="status"
            aria-live="polite"
          >
            <span />
            <p>{message}</p>
          </div>
          <div className="source-note">
            <ShieldCheck aria-hidden="true" />
            <p>
              航班数据来自{' '}
              <a
                href="https://opensky-network.org/"
                target="_blank"
                rel="noreferrer"
              >
                OpenSky Network <ExternalLink aria-hidden="true" />
              </a>
              ，通常约每 10 秒更新一次。
            </p>
          </div>
        </aside>

        <section className="radar-panel">
          <div className="panel-heading">
            <div>
              <p>LIVE AIRSPACE</p>
              <h2>附近空域</h2>
            </div>
            <div className="scan-meta">
              <Clock3 aria-hidden="true" />
              <span>
                上次更新
                <br />
                <strong>{formatTime(result?.timestamp ?? null)}</strong>
              </span>
            </div>
          </div>
          <RadarScope
            aircraft={result?.aircraft ?? []}
            selected={selected?.icao24 ?? null}
            radius={radius}
            onSelect={setSelectedId}
          />
          {!position && (
            <div className="radar-empty">
              <MapPin aria-hidden="true" />
              <strong>雷达待命</strong>
              <span>先允许定位，附近飞机会出现在这里</span>
            </div>
          )}
        </section>

        <aside className="results-panel">
          <div className="results-heading">
            <div>
              <p>NEARBY TRAFFIC</p>
              <h2>附近飞机</h2>
            </div>
            <span className="result-count">{result?.aircraft.length ?? 0}</span>
          </div>
          {selected ? (
            <article className="aircraft-card">
              <div className="aircraft-card-top">
                <div className="plane-badge">
                  <Plane
                    style={{ transform: `rotate(${selected.track ?? 0}deg)` }}
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <p>最近的飞机</p>
                  <h3>{selected.callsign || '未知呼号'}</h3>
                  <span>ICAO · {selected.icao24.toUpperCase()}</span>
                </div>
              </div>
              <div className="distance-readout">
                <strong>{selected.distance.toFixed(1)}</strong>
                <span>公里外</span>
              </div>
              <dl className="flight-stats">
                <div>
                  <dt>
                    <Gauge aria-hidden="true" /> 高度
                  </dt>
                  <dd>{formatAltitude(selected.altitude)}</dd>
                </div>
                <div>
                  <dt>
                    <Navigation aria-hidden="true" /> 航向
                  </dt>
                  <dd>{compass(selected.track)}</dd>
                </div>
                <div>
                  <dt>
                    <ArrowUpRight aria-hidden="true" /> 地速
                  </dt>
                  <dd>{formatSpeed(selected.velocity)}</dd>
                </div>
                <div>
                  <dt>
                    {(selected.verticalRate ?? 0) < 0 ? (
                      <ArrowDownRight aria-hidden="true" />
                    ) : (
                      <ArrowUpRight aria-hidden="true" />
                    )}{' '}
                    垂直速度
                  </dt>
                  <dd>
                    {selected.verticalRate === null
                      ? '—'
                      : `${selected.verticalRate > 0 ? '+' : ''}${selected.verticalRate.toFixed(1)} m/s`}
                  </dd>
                </div>
              </dl>
              <div className="aircraft-origin">
                <span>
                  {selected.category
                    ? categoryNames[selected.category] || '航空器'
                    : '航空器'}
                </span>
                <span>{selected.country}</span>
              </div>
            </article>
          ) : (
            <div className="results-empty">
              <Plane aria-hidden="true" />
              <p>
                {result
                  ? '这片空域暂时很安静'
                  : '扫描后，这里会显示最近一架飞机的高度、速度和航向。'}
              </p>
            </div>
          )}

          {(result?.aircraft.length ?? 0) > 1 && (
            <div className="aircraft-list" aria-label="附近飞机列表">
              {result!.aircraft.map((plane, index) => (
                <button
                  key={plane.icao24}
                  type="button"
                  className={
                    plane.icao24 === selected?.icao24 ? 'is-active' : ''
                  }
                  onClick={() => setSelectedId(plane.icao24)}
                >
                  <span className="list-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="list-flight">
                    <strong>
                      {plane.callsign || plane.icao24.toUpperCase()}
                    </strong>
                    <small>{formatAltitude(plane.altitude)}</small>
                  </span>
                  <span className="list-distance">
                    {plane.distance.toFixed(1)} km
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </section>

      <footer>
        <span>位置坐标仅用于生成附近空域边界</span>
        <span>数据可能存在延迟或覆盖盲区，请勿用于飞行安全决策</span>
      </footer>
    </main>
  );
}
