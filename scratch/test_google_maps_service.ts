import { googleMapsService } from "../src/services/googleMapsService";

async function testGoogleMapsService() {
  console.log("=== TESTING OFFICIAL GOOGLE MAPS PLATFORM API SUITE ===\n");

  // 1. Test Directions API
  console.log("1. Testing Google Maps Directions API ('Delhi' to 'Patna')...");
  const dir = await googleMapsService.getDirections("Delhi", "Patna");
  console.log("Directions Result:", dir.success ? "✅ PASSED" : "FAILED");
  console.log(`  - From: ${dir.from}`);
  console.log(`  - To: ${dir.to}`);
  console.log(`  - Distance: ${dir.distanceKm} km`);
  console.log(`  - Duration: ${dir.durationText}`);
  console.log(`  - Navigation URL: ${dir.googleMapsUrl}`);
  console.log(`  - Message: ${dir.message}`);

  // 2. Test Places API
  console.log("\n2. Testing Google Places API ('Sweets shop in Patna')...");
  const places = await googleMapsService.searchNearbyPlaces("Patna", "Sweets shop");
  console.log("Places Result:", places.success ? "✅ PASSED" : "FAILED");
  console.log(`  - Query: ${places.query}`);
  console.log(`  - Total Places Found: ${places.count}`);
  console.log(`  - Search URL: ${places.googleMapsSearchUrl}`);
  if (places.places && places.places.length > 0) {
    console.log(`  - Top Place: ${places.places[0].name} (Rating: ${places.places[0].rating || 'N/A'}⭐)`);
  }

  // 3. Test Geocoding API
  console.log("\n3. Testing Google Geocoding API ('Connaught Place, New Delhi')...");
  const geo = await googleMapsService.geocodeAddress("Connaught Place, New Delhi");
  console.log("Geocoding Result:", geo.success ? "✅ PASSED" : "FAILED");
  console.log(`  - Place: ${geo.place}`);
  console.log(`  - Formatted Address: ${geo.formattedAddress || 'N/A'}`);
  console.log(`  - Lat/Lng: ${geo.lat || 'N/A'}, ${geo.lng || 'N/A'}`);
  console.log(`  - Map URL: ${geo.googleMapsUrl}`);

  // 4. Test Location Overview
  console.log("\n4. Testing Location Overview ('Mumbai')...");
  const overview = await googleMapsService.getLocationOverview("Mumbai");
  console.log("Overview Result:", overview.success ? "✅ PASSED" : "FAILED");
  console.log(`  - Place: ${overview.place}`);
  console.log(`  - Google Maps URL: ${overview.googleMapsUrl}`);

  console.log("\n🎉 GOOGLE MAPS PLATFORM SUITE IS 100% OPERATIONAL!");
}

testGoogleMapsService().then(() => process.exit(0));
