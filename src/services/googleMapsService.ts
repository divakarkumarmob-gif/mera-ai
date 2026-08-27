/**
 * Google Maps Platform Service with TomTom Live Traffic & Places Fallback
 * Primary: Google Maps Platform APIs (Directions, Places, Geocoding)
 * Fallback: TomTom Maps Platform (https://docs.tomtom.com/)
 */

import { tomTomService } from "./tomTomService";

export interface GoogleDirectionsResult {
  success: boolean;
  from: string;
  to: string;
  distanceKm: string;
  durationText: string;
  durationMinutes: number;
  durationInTrafficText?: string;
  startAddress: string;
  endAddress: string;
  steps: string[];
  googleMapsUrl: string;
  source: string;
  message: string;
}

export interface GooglePlaceItem {
  name: string;
  address: string;
  rating?: number;
  userRatingsTotal?: number;
  openNow?: boolean;
  placeId?: string;
  lat?: number;
  lng?: number;
  googleMapsUrl: string;
}

export interface GooglePlacesResult {
  success: boolean;
  query: string;
  count: number;
  places: GooglePlaceItem[];
  googleMapsSearchUrl: string;
  source: string;
  message: string;
}

export interface GoogleGeocodeResult {
  success: boolean;
  place: string;
  formattedAddress?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  googleMapsUrl: string;
  source?: string;
  message: string;
}

class GoogleMapsService {
  private getApiKey(): string | null {
    return (
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAP_API_KEY ||
      process.env.GOOGLE_MAPS_KEY ||
      process.env.GEMINI_API_KEY || // Common Google Cloud API Key
      null
    );
  }

  /**
   * 1. Get Driving / Transit Directions between two places
   * Primary: Google Maps Directions API
   * Fallback: TomTom Routing API (with live traffic & delays)
   */
  public async getDirections(
    origin: string,
    destination: string,
    mode: "driving" | "walking" | "bicycling" | "transit" = "driving"
  ): Promise<GoogleDirectionsResult> {
    const cleanOrigin = String(origin || "").trim();
    const cleanDest = String(destination || "").trim();

    if (!cleanOrigin || !cleanDest) {
      return {
        success: false,
        from: cleanOrigin,
        to: cleanDest,
        distanceKm: "0",
        durationText: "N/A",
        durationMinutes: 0,
        startAddress: "",
        endAddress: "",
        steps: [],
        googleMapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(cleanOrigin)}&destination=${encodeURIComponent(cleanDest)}`,
        source: "google_maps",
        message: "Origin aur Destination dono zaroori hain.",
      };
    }

    const universalMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(cleanOrigin)}&destination=${encodeURIComponent(cleanDest)}&travelmode=${mode}`;
    const apiKey = this.getApiKey();

    // 1. Try Google Maps Directions API
    if (apiKey) {
      try {
        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(cleanOrigin)}&destination=${encodeURIComponent(cleanDest)}&mode=${mode}&departure_time=now&key=${apiKey}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.status === "OK" && data.routes && data.routes.length > 0) {
          const leg = data.routes[0].legs[0];
          const distKm = (leg.distance.value / 1000).toFixed(1);
          const durationMins = Math.round(leg.duration.value / 60);
          const durationText = leg.duration.text;
          const durationInTraffic = leg.duration_in_traffic ? leg.duration_in_traffic.text : undefined;

          const steps: string[] = (leg.steps || []).slice(0, 8).map((step: any) =>
            String(step.html_instructions || "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
          );

          return {
            success: true,
            from: leg.start_address || cleanOrigin,
            to: leg.end_address || cleanDest,
            distanceKm: distKm,
            durationText: durationInTraffic ? `${durationText} (Traffic: ${durationInTraffic})` : durationText,
            durationMinutes: durationMins,
            durationInTrafficText: durationInTraffic,
            startAddress: leg.start_address,
            endAddress: leg.end_address,
            steps,
            googleMapsUrl: universalMapsUrl,
            source: "google_maps_directions_api",
            message: `Boss, "${cleanOrigin}" se "${cleanDest}" tak ki doori ${distKm} km hai aur lagbhag ${durationInTraffic || durationText} lagenge. 🚗📍`,
          };
        }
      } catch (e: any) {
        console.warn("[GoogleMaps] Directions API error, attempting TomTom fallback:", e?.message || e);
      }
    }

    // 2. Fallback to TomTom Routing Platform (https://docs.tomtom.com/)
    try {
      const tomtomMode = mode === "walking" ? "pedestrian" : mode === "bicycling" ? "bicycle" : "car";
      const tomtomRes = await tomTomService.calculateRoute(cleanOrigin, cleanDest, tomtomMode);
      if (tomtomRes && tomtomRes.success) {
        return {
          success: true,
          from: tomtomRes.from,
          to: tomtomRes.to,
          distanceKm: tomtomRes.distanceKm,
          durationText: tomtomRes.durationText,
          durationMinutes: tomtomRes.durationMinutes,
          startAddress: tomtomRes.startAddress || cleanOrigin,
          endAddress: tomtomRes.endAddress || cleanDest,
          steps: tomtomRes.steps,
          googleMapsUrl: universalMapsUrl,
          source: "tomtom_routing_fallback",
          message: tomtomRes.message,
        };
      }
    } catch (err: any) {
      console.warn("[TomTom] Routing Fallback error:", err?.message || err);
    }

    // 3. Universal Navigation Deep Link (100% Guaranteed)
    return {
      success: true,
      from: cleanOrigin,
      to: cleanDest,
      distanceKm: "Calculated in Map",
      durationText: "Live in Google Maps",
      durationMinutes: 0,
      startAddress: cleanOrigin,
      endAddress: cleanDest,
      steps: [`Open Navigation: ${universalMapsUrl}`],
      googleMapsUrl: universalMapsUrl,
      source: "google_maps_universal",
      message: `Boss, "${cleanOrigin}" se "${cleanDest}" ka Google Maps route link ready hai: ${universalMapsUrl}`,
    };
  }

  /**
   * 2. Search Nearby Places / Amenities
   * Primary: Google Places API (Ratings, Reviews & Open status)
   * Fallback: TomTom POI Search API
   */
  public async searchNearbyPlaces(
    place: string,
    amenityOrQuery: string
  ): Promise<GooglePlacesResult> {
    const cleanPlace = String(place || "").trim();
    const cleanQuery = String(amenityOrQuery || "").trim();
    const fullQuery = `${cleanQuery} in ${cleanPlace}`;
    const universalSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullQuery)}`;

    const apiKey = this.getApiKey();

    // 1. Try Google Places TextSearch API
    if (apiKey) {
      try {
        const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(fullQuery)}&key=${apiKey}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.status === "OK" && Array.isArray(data.results) && data.results.length > 0) {
          const places: GooglePlaceItem[] = data.results.slice(0, 8).map((p: any) => ({
            name: p.name,
            address: p.formatted_address || p.vicinity || "",
            rating: p.rating ? Number(p.rating) : undefined,
            userRatingsTotal: p.user_ratings_total ? Number(p.user_ratings_total) : undefined,
            openNow: p.opening_hours?.open_now,
            placeId: p.place_id,
            lat: p.geometry?.location?.lat,
            lng: p.geometry?.location?.lng,
            googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + " " + (p.formatted_address || ""))}&query_place_id=${p.place_id}`,
          }));

          return {
            success: true,
            query: fullQuery,
            count: places.length,
            places,
            googleMapsSearchUrl: universalSearchUrl,
            source: "google_places_api",
            message: `"${cleanPlace}" me top ${places.length} "${cleanQuery}" places mil gaye hain. ⭐`,
          };
        }
      } catch (e: any) {
        console.warn("[GoogleMaps] Places API error, attempting TomTom POI fallback:", e?.message || e);
      }
    }

    // 2. Fallback to TomTom POI Search
    try {
      const tomtomRes = await tomTomService.searchNearbyPlaces(cleanPlace, cleanQuery);
      if (tomtomRes && tomtomRes.success && tomtomRes.places.length > 0) {
        const places: GooglePlaceItem[] = tomtomRes.places.map((p) => ({
          name: p.name,
          address: p.address,
          lat: p.lat,
          lng: p.lon,
          googleMapsUrl: p.mapUrl,
        }));

        return {
          success: true,
          query: fullQuery,
          count: places.length,
          places,
          googleMapsSearchUrl: universalSearchUrl,
          source: "tomtom_places_fallback",
          message: tomtomRes.message,
        };
      }
    } catch (err: any) {
      console.warn("[TomTom] POI fallback error:", err?.message || err);
    }

    // 3. Universal Search Link
    return {
      success: true,
      query: fullQuery,
      count: 0,
      places: [],
      googleMapsSearchUrl: universalSearchUrl,
      source: "google_maps_universal",
      message: `"${fullQuery}" ke results Google Maps par open karein: ${universalSearchUrl}`,
    };
  }

  /**
   * 3. Geocode Location / Address
   * Primary: Google Geocoding API
   * Fallback: TomTom Geocoding API
   */
  public async geocodeAddress(address: string): Promise<GoogleGeocodeResult> {
    const clean = String(address || "").trim();
    const universalUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean)}`;

    const apiKey = this.getApiKey();

    // 1. Try Google Geocoding API
    if (apiKey) {
      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(clean)}&key=${apiKey}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.status === "OK" && data.results && data.results.length > 0) {
          const top = data.results[0];
          return {
            success: true,
            place: clean,
            formattedAddress: top.formatted_address,
            lat: top.geometry?.location?.lat,
            lng: top.geometry?.location?.lng,
            placeId: top.place_id,
            googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(top.formatted_address)}&query_place_id=${top.place_id}`,
            source: "google_geocoding_api",
            message: `"${clean}" coordinates: Lat ${top.geometry?.location?.lat}, Lng ${top.geometry?.location?.lng} (${top.formatted_address})`,
          };
        }
      } catch (e: any) {
        console.warn("[GoogleMaps] Geocode API error, trying TomTom fallback:", e?.message || e);
      }
    }

    // 2. Try TomTom Geocoding Fallback
    try {
      const tomtomGeo = await tomTomService.geocode(clean);
      if (tomtomGeo && tomtomGeo.success && tomtomGeo.lat !== undefined) {
        return {
          success: true,
          place: clean,
          formattedAddress: tomtomGeo.formattedAddress,
          lat: tomtomGeo.lat,
          lng: tomtomGeo.lon,
          googleMapsUrl: universalUrl,
          source: "tomtom_geocoding_fallback",
          message: tomtomGeo.message,
        };
      }
    } catch (err: any) {
      console.warn("[TomTom] Geocode fallback error:", err?.message || err);
    }

    return {
      success: true,
      place: clean,
      googleMapsUrl: universalUrl,
      source: "google_maps_universal",
      message: `"${clean}" Google Maps link: ${universalUrl}`,
    };
  }

  /**
   * 4. Location Overview & Map Briefing
   */
  public async getLocationOverview(place: string): Promise<any> {
    const geocode = await this.geocodeAddress(place);
    return {
      success: true,
      place: place,
      formattedAddress: geocode.formattedAddress || place,
      latitude: geocode.lat,
      longitude: geocode.lng,
      googleMapsUrl: geocode.googleMapsUrl,
      source: geocode.source,
      message: `Location "${place}" ka Map link aur coordinates ready hain: ${geocode.googleMapsUrl}`,
    };
  }
}

export const googleMapsService = new GoogleMapsService();
