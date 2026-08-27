import net from "net";
import dgram from "dgram";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

async function testPhoneWakeupSweep() {
  const subnet = "192.168.31";
  console.log(`=== TESTING MULTI-PROTOCOL ACTIVE WAKEUP SWEEP ON ${subnet}.0/24 ===`);

  // Step 1: Broadcast UDP wake-up on Port 9, 137, 5353, 1900
  const udpSocket = dgram.createSocket("udp4");
  const wakePayload = Buffer.from([0x00, 0x00, 0x01, 0x00]);
  const ports = [9, 137, 5353, 1900];

  udpSocket.bind(() => {
    udpSocket.setBroadcast(true);
    for (const port of ports) {
      udpSocket.send(wakePayload, port, `${subnet}.255`, () => {});
    }
  });

  // Step 2: Parallel TCP SYN Sweep across all 254 IPs on common phone ports (80, 443, 8008, 62078, 5555)
  const probePorts = [80, 443, 8008, 62078, 5555, 137, 8080];
  const promises: Promise<void>[] = [];

  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    for (const port of [80, 443, 8008, 62078, 5353]) {
      promises.push(
        new Promise<void>((resolve) => {
          const socket = new net.Socket();
          socket.setTimeout(350);
          socket.on("connect", () => {
            socket.destroy();
            resolve();
          });
          socket.on("error", () => {
            socket.destroy();
            resolve();
          });
          socket.on("timeout", () => {
            socket.destroy();
            resolve();
          });
          socket.connect(port, ip);
        })
      );
    }
  }

  console.log(`Sending ${promises.length} active multi-port probes to wake up all sleeping phones...`);
  await Promise.all(promises);
  try { udpSocket.close(); } catch {}

  // Wait 300ms for ARP table to populate
  await new Promise((r) => setTimeout(r, 400));

  // Step 3: Check ARP table
  const { stdout } = await execPromise("arp -a");
  console.log("\nKernel ARP Table Output:");
  console.log(stdout);
}

testPhoneWakeupSweep().then(() => process.exit(0));
