import { jioSaavnService } from "../src/services/jioSaavnService";

async function testDeewana() {
  const list = [
    "Main Sehra Bandh Ke",
    "Main Sehra Bandh Ke Deewana",
    "Main Sehra Bandh Ke Udit Narayan",
    "Deewana Mujh Sa Nahin Sehra",
    "Me Sehra Bandh Ke",
    "Dulhe Ka Sehra Suhana Lagta Hai Nusrat Fateh Ali Khan",
    "Dulhe Ka Sehra Dhadkan Nusrat"
  ];

  for (const q of list) {
    const res = await jioSaavnService.searchSong(q);
    console.log(`\n🔍 Query: "${q}" -> Found: ${res.count}`);
    if (res.songs) {
      for (const s of res.songs.slice(0, 3)) {
        console.log(`  - "${s.songName}" | Singer: ${s.artistName} | Album: ${s.albumName}`);
      }
    }
  }
}

testDeewana().catch(console.error);
