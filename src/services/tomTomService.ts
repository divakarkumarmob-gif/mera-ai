/**
 * TomTom Maps Platform Service
 * Official TomTom APIs for Routing, Traffic, POI / Place Search, and Geocoding.
 * Documentation: https://docs.tomtom.com/
 * Used as high-reliability Secondary Fallback for Google Maps.
 */

export interface TomTomDirectionsResult {
  success: boolean;
  from: string;
  to: string;
  distanceKm: string;
  durationText: string;
  durationMinutes: number;
  trafficDelayMinutes?: number;
  startAddress?: string;
  endAddress?: string;
  steps: string[];
  mapUrl: string;
  source: string;
  message: string;
}

export interface TomTomPlaceItem {
  name: string;
  address: string;
  categories?: string[];
  lat?: number;
  lon?: number;
  mapUrl: string;
}

export interface TomTomPlacesResult {
  success: boolean;
  query: string;
  count: number;
  places: TomTomPlaceItem[];
  source: string;
  message: string;
}

export interface TomTomGeocodeResult {
  success: boolean;
  place: string;
  formattedAddress?: string;
  lat?: number;
  lon?: number;
  source: string;
  message: string;
}

class TomTomService {
  private getApiKey(): string | null {
    return (
      process.env.TOMTOM_API_KEY ||
      process.env.TOMTOM_KEY ||
      process.env.TOM_TOM_API_KEY ||
      null
    );
  }

  /**
   * 1. Geocode location using TomTom Search API
   */
  public async geocode(query: string): Promise<TomTomGeocodeResult | null> {
    const key = this.getApiKey();
    if (!key) return null;

    try {
      const url = `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(query)}.json?key=${key}&limit=1`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const first = data?.results?.[0];
      if (first && first.position) {
        return {
          success: true,
          place: query,
          formattedAddress: first.address?.freeformAddress || query,
          lat: first.position.lat,
          lon: first.position.lon,
          source: "tomtom_geocoding",
          message: `Location "${query}" coordinates: Lat ${first.position.lat}, Lon ${first.position.lon}`,
        };
      }
    } catch (e: any) {
      console.warn("[TomTom] Geocode error:", e?.message || e);
    }
    return null;
  }

  /**
   * 2. Calculate Route & Directions with Live Traffic using TomTom Routing API
   */
  public async calculateRoute(
    origin: string,
    destination: string,
    mode: "car" | "truck" | "pedestrian" | "bicycle" = "car"
  ): Promise<TomTomDirectionsResult | null> {
    const key = this.getApiKey();
    if (!key) return null;

    try {
      const [startGeo, endGeo] = await Promise.all([
        this.geocode(origin),
        this.geocode(destination),
      ]);

      if (!startGeo || !endGeo || startGeo.lat === undefined || endGeo.lat === undefined) {
        return null;
      }

      const travelModeMap: Record<string, string> = {
        car: "car",
        walking: "pedestrian",
        bicycling: "bicycle",
        transit: "bus",
      };
      const tomtomTravelMode = travelModeMap[mode] || "car";

      const url = `https://api.tomtom.com/routing/1/calculateRoute/${startGeo.lat},${startGeo.lon}:${endGeo.lat},${endGeo.lon}/json?key=${key}&travelMode=${tomtomTravelMode}&traffic=true&instructionsType=text`;
      const res = await fetch(url);
      if (!res.ok) return null;

      const data = await res.json();
      const route = data?.routes?.[0];
      if (route && route.summary) {
        const distKm = (route.summary.lengthInMeters / 1000).toFixed(1);
        const totalSecs = route.summary.travelTimeInSeconds;
        const totalMins = Math.round(totalSecs / 60);
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        const durationFormatted = hours > 0 ? `${hours} hours ${mins} mins` : `${mins} mins`;
        const trafficDelayMins = Math.round((route.summary.trafficDelayInSeconds || 0) / 60);

        // Turn by turn guidance steps
        const steps: string[] = (route.guidance?.instructions || [])
          .slice(0, 8)
          .map((inst: any) => String(inst.message || "").trim())
          .filter(Boolean);

        const mapUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;

        return {
          success: true,
          from: startGeo.formattedAddress || origin,
          to: endGeo.formattedAddress || destination,
          distanceKm: distKm,
          durationText: trafficDelayMins > 0 ? `${durationFormatted} (Traffic Delay: ${trafficDelayMins} mins)` : durationFormatted,
          durationMinutes: totalMins,
          trafficDelayMinutes: trafficDelayMins,
          startAddress: startGeo.formattedAddress,
          endAddress: endGeo.formattedAddress,
          steps,
          mapUrl,
          source: "tomtom_routing_api",
          message: `Boss, "${origin}" se "${destination}" tak ki doori ${distKm} km hai aur lagbhag ${durationFormatted} lagenge (TomTom Live Traffic Engine). 🚗📍`,
        };
      }
    } catch (e: any) {
      console.warn("[TomTom] Routing API error:", e?.message || e);
    }
    return null;
  }

  /**
   * 3. Search Nearby Places & POIs using TomTom Fuzzy / POI Search API
   */
  public async searchNearbyPlaces(
    place: string,
    query: string
  ): Promise<TomTomPlacesResult | null> {
    const key = this.getApiKey();
    if (!key) return null;

    try {
      const fullQuery = `${query} in ${place}`;
      const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(fullQuery)}.json?key=${key}&limit=8`;
      const res = await fetch(url);
      if (!res.ok) return null;

      const data = await res.json();
      if (Array.isArray(data?.results) && data.results.length > 0) {
        const places: TomTomPlaceItem[] = data.results.map((item: any) => ({
          name: item.poi?.name || item.address?.freeformAddress || "Place",
          address: item.address?.freeformAddress || "",
          categories: item.poi?.categories || [],
          lat: item.position?.lat,
          lon: item.position?.lon,
          mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((item.poi?.name || "") + " " + (item.address?.freeformAddress || ""))}`,
        }));

        return {
          success: true,
          query: fullQuery,
          count: places.length,
          places,
          source: "tomtom_poi_api",
          message: `"${place}" me TomTom Maps par top ${places.length} "${query}" places mil gaye hain. 📍`,
        };
      }
    } catch (e: any) {
      console.warn("[TomTom] POI Search error:", e?.message || e);
    }
    return null;
  }
}

export const tomTomService = new TomTomService();
