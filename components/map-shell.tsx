'use client';

import dynamic from 'next/dynamic';
import type { MapCompany } from '@/components/company-map';

/**
 * Client-side wrapper so the map can be loaded with `ssr: false`.
 * Leaflet reads `window` at import time, and Next 15 only allows disabling SSR
 * for a dynamic import inside a Client Component.
 */
const CompanyMap = dynamic(() => import('@/components/company-map').then((m) => m.CompanyMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[72vh] items-center justify-center rounded-lg border border-black/10 text-sm text-black/40">
      Loading map…
    </div>
  ),
});

export function MapShell({ companies }: { companies: MapCompany[] }) {
  return <CompanyMap companies={companies} />;
}
