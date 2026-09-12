import { geoCentroid } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import topology from 'world-atlas/countries-110m.json';
import type { CigarEntry } from './types';
import type { GlobePoint } from './globe-geometry';

const countries = topology as unknown as Topology<{
  countries: GeometryCollection;
}>;
export const globeCountries = feature(countries, countries.objects.countries);

const aliases: Record<string, string> = {
  'dominican republic': 'Dominican Rep.',
  'dominican rep': 'Dominican Rep.',
  'dominican rep.': 'Dominican Rep.',
  dr: 'Dominican Rep.',
  'united states': 'United States of America',
  usa: 'United States of America',
  us: 'United States of America',
  'united states of america': 'United States of America',
  uk: 'United Kingdom',
  'the bahamas': 'Bahamas',
  'côte d’ivoire': "Côte d'Ivoire",
};
const originPoints: Record<string, GlobePoint> = {
  Cuba: [-79.5, 22],
  'Dominican Rep.': [-70.2, 18.9],
  Nicaragua: [-85, 13],
  Honduras: [-86.5, 14.8],
  'United States of America': [-98, 39],
};

export interface GlobePin {
  id: string;
  label: string;
  count: number;
  coordinates: GlobePoint;
  names: string[];
}

export function groupGlobePins(
  entries: CigarEntry[],
  mode: 'origin' | 'purchase',
): { pins: GlobePin[]; missing: number } {
  const groups = new Map<string, GlobePin>();
  let missing = 0;
  for (const entry of entries) {
    let id: string;
    let label: string;
    let coordinates: GlobePoint;
    if (mode === 'origin') {
      label = entry.country;
      const canonical =
        aliases[entry.country.trim().toLowerCase()] ?? entry.country.trim();
      const country = globeCountries.features.find(
        (item) =>
          String(
            (item.properties as { name?: string } | null)?.name ?? '',
          ).toLowerCase() === canonical.toLowerCase(),
      );
      if (!country) {
        missing++;
        continue;
      }
      id = String(country.id);
      coordinates =
        originPoints[
          String((country.properties as { name?: string } | null)?.name)
        ] ?? geoCentroid(country);
    } else {
      if (
        entry.purchaseLat === null ||
        entry.purchaseLng === null ||
        !Number.isFinite(entry.purchaseLat) ||
        !Number.isFinite(entry.purchaseLng) ||
        Math.abs(entry.purchaseLat) > 90 ||
        Math.abs(entry.purchaseLng) > 180
      ) {
        missing++;
        continue;
      }
      coordinates = [entry.purchaseLng, entry.purchaseLat];
      id = `${coordinates[0].toFixed(3)},${coordinates[1].toFixed(3)}`;
      label = entry.purchasePlace || 'Saved place';
    }
    const existing = groups.get(id);
    if (existing) {
      existing.count++;
      existing.names.push(entry.fullName);
    } else
      groups.set(id, {
        id,
        label,
        count: 1,
        coordinates,
        names: [entry.fullName],
      });
  }
  return { pins: [...groups.values()], missing };
}
