import http from "http";

function checkPort(port: number) {
  return new Promise<void>((resolve) => {
    const req = http.get(`http://localhost:${port}/api/network/wifi-radar`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        console.log(`\n=== PORT ${port} RESPONSE === (HTTP ${res.status})`);
        try {
          const json = JSON.parse(data);
          console.log(`Total devices: ${json.totalDevices}`);
          console.log(`Devices list:`, json.devices?.map((d: any) => `${d.vendor} (${d.ip})`));
        } catch {
          console.log("Raw response:", data.slice(0, 200));
        }
        resolve();
      });
    });
    req.on("error", (err) => {
      console.log(`Port ${port}: ${err.message}`);
      resolve();
    });
    req.setTimeout(2000, () => {
      req.destroy();
      resolve();
    });
  });
}

async function run() {
  await checkPort(3000);
  await checkPort(3001);
  await checkPort(8080);
  await checkPort(5000);
}

run();
