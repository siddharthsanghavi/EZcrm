'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapPoint = {
  city: string;
  region: string | null;
  latitude: number;
  longitude: number;
  total: number;
  tier1: number;
  tier2: number;
  names: string[];
};

/** Bigger dot for more companies, but flattened so Atlanta doesn't swallow the map. */
function radiusFor(total: number) {
  return Math.min(28, 6 + Math.sqrt(total) * 2.6);
}

/** Colour by the best tier present — the thing that decides where you go first. */
function colourFor(p: MapPoint) {
  if (p.tier1 > 0) return { fill: '#7c3aed', ring: '#5b21b6' }; // violet - Tier 1
  if (p.tier2 > 0) return { fill: '#0284c7', ring: '#075985' }; // blue   - Tier 2
  return { fill: '#64748b', ring: '#334155' }; // slate - everything else
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

export function CompanyMap({ points }: { points: MapPoint[] }) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!holder.current || mapRef.current) return;

    const map = L.map(holder.current, { scrollWheelZoom: true }).setView([32.75, -83.4], 7);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    const layer = L.layerGroup().addTo(map);

    points.forEach((p) => {
      const { fill, ring } = colourFor(p);

      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: radiusFor(p.total),
        fillColor: fill,
        color: ring,
        weight: 1.5,
        opacity: 0.9,
        fillOpacity: 0.55,
      });

      const shown = p.names.slice(0, 8).map((n) => `<li>${escapeHtml(n)}</li>`).join('');
      const more = p.total > 8 ? `<li class="more">+ ${p.total - 8} more</li>` : '';
      const badges = [
        p.tier1 ? `<span class="b b1">${p.tier1} Tier 1</span>` : '',
        p.tier2 ? `<span class="b b2">${p.tier2} Tier 2</span>` : '',
      ].join('');

      marker.bindPopup(
        `<div class="pop">
           <strong>${escapeHtml(p.city)}</strong>
           <div class="sub">${escapeHtml(p.region ?? '')} · ${p.total} compan${p.total === 1 ? 'y' : 'ies'}</div>
           ${badges ? `<div class="badges">${badges}</div>` : ''}
           <ul>${shown}${more}</ul>
           <a href="/companies?q=${encodeURIComponent(p.city)}">Open in list &rarr;</a>
         </div>`,
        { maxWidth: 280 },
      );

      marker.addTo(layer);
    });

    // Frame everything that was geocoded rather than assuming a fixed view.
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number])), {
        padding: [30, 30],
      });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [points]);

  const totals = points.reduce(
    (a, p) => ({ all: a.all + p.total, t1: a.t1 + p.tier1, t2: a.t2 + p.tier2 }),
    { all: 0, t1: 0, t2: 0 },
  );

  return (
    <div className="space-y-3">
      <div ref={holder} className="h-[70vh] w-full rounded-lg border border-black/10" />

      <div className="flex flex-wrap items-center gap-4 text-xs text-black/60">
        <span className="flex items-center gap-1.5">
          <i className="h-3 w-3 rounded-full" style={{ background: '#7c3aed' }} /> Tier 1 present
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-3 w-3 rounded-full" style={{ background: '#0284c7' }} /> Tier 2 present
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-3 w-3 rounded-full" style={{ background: '#64748b' }} /> Tier 3 / Reference
        </span>
        <span className="ml-auto">
          {points.length} locations · {totals.all} companies · circle size = how many
        </span>
      </div>

      <p className="text-xs text-black/45">
        Pins are placed by city, not street address, so companies in the same town share a point.
        Click one to see who&apos;s there.{' '}
        <Link href="/companies" className="underline">
          Browse the full list
        </Link>
        .
      </p>
    </div>
  );
}
