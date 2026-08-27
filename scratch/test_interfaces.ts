import os from "os";

console.log("=== ALL NETWORK INTERFACES ===");
const ifaces = os.networkInterfaces();
for (const [name, list] of Object.entries(ifaces)) {
  for (const info of list || []) {
    if (info.family === "IPv4" && !info.internal) {
      console.log(`Interface: [${name}] -> IP: ${info.address} (Netmask: ${info.netmask})`);
    }
  }
}
