'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';

/**
 * One pin: a single located place. A company with three plants is three pins
 * that all open the same company page, which is the whole point of
 * supabase/migrations/015_company_locations.sql — the map used to show a
 * manufacturer at its head office and nowhere else.
 */
export type MapPin = {
  /** The location's id, not the company's. Unique per pin. */
  id: string;
  companyId: string;
  name: string;
  /** "Plant 2", when this company has more than one place. */
  place: string | null;
  city: string | null;
  county: string | null;
  area: string | null;
  region: string | null;
  type: string | null;
  tier: string | null;
  status: string;
  owner: string | null;
  latitude: number;
  longitude: number;
  precise: boolean;
};

/** Below this zoom you get one bubble per region; above it, individual companies. */
const AREA_ZOOM = 9;

const TIER_COLOUR: Record<string, string> = {
  'Tier 1': '#7c3aed',
  'Tier 2': '#0284c7',
  'Tier 3': '#0f766e',
  Reference: '#64748b',
};
const colourFor = (tier: string | null) => TIER_COLOUR[tier ?? ''] ?? '#64748b';
const tierRank = (t: string | null | undefined) =>
  t === 'Tier 1' ? 1 : t === 'Tier 2' ? 2 : t === 'Tier 3' ? 3 : 4;
const colourForRank = (r: number) => ['#7c3aed', '#0284c7', '#0f766e', '#64748b'][r - 1];

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

type Group = {
  key: string;
  label: string;
  lat: number;
  lon: number;
  /** Distinct companies, not pins: two plants in one region are one company. */
  total: number;
  pins: number;
  best: number;
  tier1: number;
  tier2: number;
  names: string[];
};

/**
 * Group by region rather than by pixel proximity. Proximity clustering at
 * statewide zoom produced a pile of overlapping bubbles across metro Atlanta.
 * Regions are a stable unit — twelve of them, derived from coordinates — so the
 * bubbles stay put as you pan and each one means something.
 */
function groupByArea(pins: MapPin[]): Group[] {
  const map = new Map<
    string,
    Group & { sumLat: number; sumLon: number; seen: Set<string> }
  >();

  for (const c of pins) {
    const key = c.area ?? c.county ?? c.city ?? 'Unknown';
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        label: c.area ?? key,
        lat: 0,
        lon: 0,
        sumLat: 0,
        sumLon: 0,
        total: 0,
        pins: 0,
        best: 4,
        tier1: 0,
        tier2: 0,
        names: [],
        seen: new Set(),
      };
      map.set(key, g);
    }
    g.pins += 1;
    // The bubble reads "12 companies", so a company with two plants in the
    // same region has to count once — tier tallies and the name list follow
    // the same rule, or the numbers under the bubble disagree with it.
    const first = !g.seen.has(c.companyId);
    if (first) {
      g.seen.add(c.companyId);
      g.total += 1;
      if (c.tier === 'Tier 1') g.tier1 += 1;
      if (c.tier === 'Tier 2') g.tier2 += 1;
      if (g.names.length < 6) g.names.push(c.name);
    }
    // The centroid is over pins: it is where the places are, not where the
    // companies are filed.
    g.sumLat += c.latitude;
    g.sumLon += c.longitude;
    g.best = Math.min(g.best, tierRank(c.tier));
  }

  return [...map.values()].map((g) => ({ ...g, lat: g.sumLat / g.pins, lon: g.sumLon / g.pins }));
}

export function CompanyMap({ pins }: { pins: MapPin[] }) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!holder.current || mapRef.current) return;

    const map = L.map(holder.current, { scrollWheelZoom: true }).setView([32.75, -83.4], 7);
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    // ---- region bubbles (low zoom) -----------------------------------------
    const areaLayer = L.layerGroup();

    for (const g of groupByArea(pins)) {
      const colour = colourForRank(g.best);
      const size = Math.round(Math.min(58, 26 + Math.sqrt(g.total) * 1.5));

      const marker = L.marker([g.lat, g.lon], {
        icon: L.divIcon({
          html:
            `<div class="ez-area" style="--c:${colour};width:${size}px;height:${size}px">` +
            `<span>${g.total}</span></div>`,
          className: '',
          iconSize: L.point(size, size),
        }),
      });

      const badges = [
        g.tier1 ? `<span class="b" style="--c:#7c3aed">${g.tier1} Tier 1</span>` : '',
        g.tier2 ? `<span class="b" style="--c:#0284c7">${g.tier2} Tier 2</span>` : '',
      ].join('');

      marker.bindPopup(
        `<div class="pop">
           <strong>${escapeHtml(g.label)}</strong>
           <div class="sub">${g.total} compan${g.total === 1 ? 'y' : 'ies'}</div>
           ${badges ? `<div class="badges">${badges}</div>` : ''}
           <ul>${g.names.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}${
             g.total > g.names.length
               ? `<li class="more">+ ${g.total - g.names.length} more</li>`
               : ''
           }</ul>
           <div class="approx">Zoom in for individual sites</div>
         </div>`,
        { maxWidth: 260 },
      );

      // Clicking a region bubble drops you into it.
      marker.on('click', () => map.flyTo([g.lat, g.lon], AREA_ZOOM + 1, { duration: 0.6 }));
      areaLayer.addLayer(marker);
    }

    // ---- individual companies (higher zoom) --------------------------------
    const companyLayer = L.markerClusterGroup({
      // NO disableClusteringAtZoom. It used to be 13, which was actively
      // hiding companies: the library sets `_maxZoom = disableClusteringAtZoom
      // - 1`, so clustering stopped at zoom 12 and every marker above that was
      // placed individually. Every company here is geocoded to its town centre
      // (`geo_precision` is 'city' for all of them), so 1,248 companies sit on
      // just 224 distinct points — 87 of them on Atlanta's. Unclustered, those
      // 87 markers drew on the same pixel and only the last one was clickable.
      //
      // Keeping clustering on at every zoom means that stack stays a cluster
      // you can click, and spiderfyOnMaxZoom fans it out. maxClusterRadius is
      // small enough that genuinely separate places still decluster normally.
      spiderfyOnMaxZoom: true,
      // 87 markers in one spiral needs more room than the default.
      spiderfyDistanceMultiplier: 1.6,
      showCoverageOnHover: false,
      maxClusterRadius: 28,
      chunkedLoading: true,
      iconCreateFunction: (cluster) => {
        const kids = cluster.getAllChildMarkers() as unknown as (L.CircleMarker & {
          _tier?: string | null;
        })[];
        let best = 4;
        for (const k of kids) best = Math.min(best, tierRank(k._tier));
        const n = cluster.getChildCount();
        const size = n < 10 ? 30 : n < 50 ? 36 : 42;
        return L.divIcon({
          html:
            `<div class="ez-cluster" style="--c:${colourForRank(best)};width:${size}px;height:${size}px">` +
            `<span>${n}</span></div>`,
          className: '',
          iconSize: L.point(size, size),
        });
      },
    });

    for (const co of pins) {
      const marker = L.circleMarker([co.latitude, co.longitude], {
        radius: co.tier === 'Tier 1' ? 8 : co.tier === 'Tier 2' ? 6.5 : 5,
        fillColor: colourFor(co.tier),
        color: '#ffffff',
        weight: 1.5,
        opacity: 1,
        // Hollow = pinned to the town centre, solid = real street address.
        fillOpacity: co.precise ? 0.9 : 0.35,
      }) as L.CircleMarker & { _tier?: string | null };

      marker._tier = co.tier;

      // `place` leads: on a company with several sites, "Plant 2" is the thing
      // that tells you which pin you just clicked.
      const meta = [co.place, co.type, co.city, co.county ? `${co.county} County` : null]
        .filter((x): x is string => Boolean(x))
        .map(escapeHtml)
        .join(' · ');

      marker.bindPopup(
        `<div class="pop">
           <a class="title" href="/companies/${co.companyId}">${escapeHtml(co.name)}</a>
           <div class="sub">${meta}</div>
           <div class="badges">
             ${co.tier ? `<span class="b" style="--c:${colourFor(co.tier)}">${escapeHtml(co.tier)}</span>` : ''}
             <span class="b b-status">${escapeHtml(co.status.replace(/_/g, ' '))}</span>
             ${co.owner ? `<span class="b b-owner">${escapeHtml(co.owner)}</span>` : ''}
           </div>
           ${co.precise ? '' : '<div class="approx">Approximate — pinned to town centre</div>'}
           <a class="go" href="/companies/${co.companyId}">Open company &rarr;</a>
         </div>`,
        { maxWidth: 260 },
      );

      companyLayer.addLayer(marker);
    }

    // ---- swap layers on zoom -----------------------------------------------
    const sync = () => {
      const zoomedIn = map.getZoom() >= AREA_ZOOM;
      if (zoomedIn) {
        if (map.hasLayer(areaLayer)) map.removeLayer(areaLayer);
        if (!map.hasLayer(companyLayer)) map.addLayer(companyLayer);
      } else {
        if (map.hasLayer(companyLayer)) map.removeLayer(companyLayer);
        if (!map.hasLayer(areaLayer)) map.addLayer(areaLayer);
      }
    };

    map.on('zoomend', sync);
    sync();

    return () => {
      map.off('zoomend', sync);
      map.remove();
      mapRef.current = null;
    };
  }, [pins]);

  const areas = new Set(pins.map((c) => c.area).filter(Boolean)).size;
  const companyCount = new Set(pins.map((c) => c.companyId)).size;

  return (
    <div className="space-y-3">
      <div ref={holder} className="h-[72vh] w-full rounded-lg border border-black/10" />

      <div className="flex flex-wrap items-center gap-4 text-xs text-black/60">
        {(['Tier 1', 'Tier 2', 'Tier 3', 'Reference'] as const).map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <i className="h-3 w-3 rounded-full" style={{ background: TIER_COLOUR[t] }} />
            {t}
          </span>
        ))}
        <span className="ml-auto">
          {companyCount.toLocaleString()} companies · {pins.length.toLocaleString()} locations ·{' '}
          {areas} regions
        </span>
      </div>

      <p className="text-xs text-black/45">
        Zoomed out you get one bubble per region — click it to drop in. Past zoom {AREA_ZOOM} it
        switches to individual companies, grouping nearby ones as you go; click any pin to open it.{' '}
        <Link href="/companies" className="underline">
          Browse the list
        </Link>
        .
      </p>
    </div>
  );
}
