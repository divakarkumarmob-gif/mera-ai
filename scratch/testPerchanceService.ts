import { perchanceService } from "../src/services/perchanceService";
import fs from "fs";

(async () => {
  console.log("Testing perchanceService...");
  const res = await perchanceService.generateImage("a beautiful royal Indian queen in palace balcony, golden sunset, realistic 8k");
  console.log("Result success:", res.success);
  if (res.success && res.buffer) {
    fs.writeFileSync("scratch/perchance_queen.jpg", res.buffer);
    console.log("Saved scratch/perchance_queen.jpg, bytes:", res.buffer.length);
  } else {
    console.error("Error:", res.error);
  }
})();
