import { jioSaavnService } from "../src/services/jioSaavnService";

const categories = [
  { name: "Hindi New", query: "Latest Hindi Bollywood Hits 2024 2025" },
  { name: "Hindi Old", query: "Kishore Kumar Lata Mangeshkar Mohammed Rafi 90s Romantic Evergreen" },
  { name: "Bhojpuri", query: "Bhojpuri Superhits Pawan Singh Khesari Lal Yadav Shilpi Raj" },
  { name: "Phonk", query: "Phonk Drift Brazilian Phonk Sigma Gym Phonk" },
  { name: "Haryanvi", query: "Haryanvi Superhit Songs Gulzaar Chhaniwala Renuka Panwar Sapna Choudhary" },
  { name: "Punjabi", query: "Punjabi Hits Karan Aujla Diljit Dosanjh Sidhu Moosewala AP Dhillon" },
];

async function testAllCategories() {
  console.log("=== TESTING ALL REQUESTED CATEGORIES ===");
  for (const cat of categories) {
    const res = await jioSaavnService.searchSong(cat.query, 40);
    console.log(`\n🎵 Category [${cat.name}] -> Found: ${res.count} songs (${res.success ? "✅" : "❌"})`);
    if (res.songs && res.songs.length > 0) {
      for (let i = 0; i < Math.min(3, res.songs.length); i++) {
        const s = res.songs[i];
        console.log(`   ${i + 1}. "${s.songName}" by ${s.artistName} [${s.albumName}]`);
      }
    }
  }
}

testAllCategories().catch(console.error);
