"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui";
import { haptic } from "@/lib/client/telegram";

const TILE = 256;

function lngToWorld(lng: number, z: number): number {
  return ((lng + 180) / 360) * TILE * 2 ** z;
}

function latToWorld(lat: number, z: number): number {
  const clamped = Math.max(-85.05, Math.min(85.05, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
}

function worldToLng(x: number, z: number): number {
  return (x / (TILE * 2 ** z)) * 360 - 180;
}

function worldToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

type Props = {
  lat: number | null;
  lng: number | null;
  onPick?: (lat: number, lng: number) => void;
  height?: number;
  zoom?: number;
  editable?: boolean;
  onLocate?: () => void;
};

/**
 * Dependency-free slippy map (OpenStreetMap tiles) with a fixed centre pin.
 * Dragging pans the map under the pin, releasing drops the pin at the centre —
 * the familiar "move the pin" UX, no external map library, ~4 KB of JS.
 */
export function MiniMap({ lat, lng, onPick, height = 210, zoom = 16, editable = true, onLocate }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 320, height });
  const [center, setCenter] = useState<{ lat: number; lng: number }>({ lat: lat ?? 41.2755, lng: lng ?? 69.2075 });
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [loaded, setLoaded] = useState(false);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (lat !== null && lng !== null && !drag.active) {
      setCenter({ lat, lng });
    }
  }, [lat, lng, drag.active]);

  const tiles = useCallback(() => {
    const scale = 2 ** zoom;
    const centerX = lngToWorld(center.lng, zoom);
    const centerY = latToWorld(center.lat, zoom);
    const topLeftX = centerX - size.width / 2 + drag.x;
    const topLeftY = centerY - size.height / 2 + drag.y;

    const x0 = Math.floor(topLeftX / TILE);
    const x1 = Math.floor((topLeftX + size.width) / TILE);
    const y0 = Math.floor(topLeftY / TILE);
    const y1 = Math.floor((topLeftY + size.height) / TILE);

    const result: { key: string; url: string; left: number; top: number }[] = [];
    const maxTile = 2 ** zoom;
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        if (y < 0 || y >= maxTile) continue;
        const wrappedX = ((x % maxTile) + maxTile) % maxTile;
        result.push({
          key: `${x}-${y}`,
          url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
          left: x * TILE - topLeftX,
          top: y * TILE - topLeftY,
        });
      }
    }
    void scale;
    return result;
  }, [center, drag.x, drag.y, size.height, size.width, zoom]);

  const commit = useCallback(
    (dx: number, dy: number) => {
      const centerX = lngToWorld(center.lng, zoom) - dx;
      const centerY = latToWorld(center.lat, zoom) - dy;
      const nextLat = Math.max(-85, Math.min(85, worldToLat(centerY, zoom)));
      const nextLng = Math.max(-180, Math.min(180, worldToLng(centerX, zoom)));
      setCenter({ lat: nextLat, lng: nextLng });
      setDrag({ x: 0, y: 0, active: false });
      onPick?.(Number(nextLat.toFixed(6)), Number(nextLng.toFixed(6)));
    },
    [center.lat, center.lng, onPick, zoom],
  );

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-ink-card select-none"
      style={{ height }}
      onPointerDown={(event) => {
        if (!editable) return;
        pointerRef.current = { x: event.clientX, y: event.clientY };
        setDrag({ x: 0, y: 0, active: true });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!editable || !pointerRef.current) return;
        const dx = event.clientX - pointerRef.current.x;
        const dy = event.clientY - pointerRef.current.y;
        setDrag({ x: dx, y: dy, active: true });
      }}
      onPointerUp={() => {
        if (!editable) return;
        haptic("light");
        commit(drag.x, drag.y);
        pointerRef.current = null;
      }}
      onPointerCancel={() => {
        setDrag({ x: 0, y: 0, active: false });
        pointerRef.current = null;
      }}
    >
      <div className="map-tile absolute inset-0" />
      <div
        className="absolute inset-0 transition-opacity"
        style={{ opacity: loaded ? 1 : 0 }}
      >
        {tiles().map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            draggable={false}
            loading="eager"
            decoding="async"
            className="absolute"
            style={{ left: tile.left, top: tile.top, width: TILE, height: TILE }}
            onLoad={() => setLoaded(true)}
          />
        ))}
      </div>

      {/* centre pin — stays fixed while the map pans underneath */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        <div className="flex flex-col items-center">
          <div className="h-8 w-8 rounded-full border-2 border-white bg-brand shadow-lg shadow-black/40" />
          <div className="h-4 w-[3px] bg-brand" />
          <div className="h-2 w-2 rounded-full bg-brand/80" />
        </div>
      </div>

      {editable ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-2">
          <span className="rounded-lg bg-black/55 px-2 py-1 text-[10px] text-white/85">
            Xaritani suring — pin markerni to‘g‘rilang
          </span>
          <span className="rounded-lg bg-black/55 px-2 py-1 text-[9px] text-white/60">© OpenStreetMap</span>
        </div>
      ) : null}

      {onLocate ? (
        <button
          type="button"
          onClick={() => {
            haptic("light");
            onLocate();
          }}
          className="tap absolute right-2 top-2 flex items-center gap-1.5 rounded-xl bg-black/65 px-2.5 py-2 text-[11px] font-semibold text-white"
        >
          <Icon name="location" className="h-3.5 w-3.5" />
          Meni top
        </button>
      ) : null}

      {lat === null || lng === null ? (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/70 px-6 text-center text-[12px] text-white/80">
          Lokatsiya tanlanmagan. «Meni top» tugmasini bosing yoki manzilni qo‘lda yozing.
        </div>
      ) : null}
    </div>
  );
}
