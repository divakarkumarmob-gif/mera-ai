import * as os from "os";

export interface SystemHealthMetrics {
  success: boolean;
  platform: string;
  osRelease: string;
  hostname: string;
  arch: string;
  uptimeHours: string;
  cpu: {
    model: string;
    cores: number;
    speedMHz: number;
    loadAverage: number[];
  };
  memory: {
    totalGB: string;
    usedGB: string;
    freeGB: string;
    usagePercent: number;
  };
  statusLevel: "optimal" | "moderate" | "high_load";
  message: string;
}

class SystemHealthService {
  public getHealthMetrics(): SystemHealthMetrics {
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = totalMemBytes - freeMemBytes;

    const totalGB = (totalMemBytes / (1024 ** 3)).toFixed(2);
    const freeGB = (freeMemBytes / (1024 ** 3)).toFixed(2);
    const usedGB = (usedMemBytes / (1024 ** 3)).toFixed(2);
    const usagePercent = Math.round((usedMemBytes / totalMemBytes) * 100);

    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model || "Unknown CPU";
    const cpuSpeed = cpus[0]?.speed || 0;
    const coreCount = cpus.length;

    const uptimeSeconds = os.uptime();
    const uptimeHrs = (uptimeSeconds / 3600).toFixed(1);

    const loadAvg = os.loadavg();

    let statusLevel: "optimal" | "moderate" | "high_load" = "optimal";
    if (usagePercent > 85) statusLevel = "high_load";
    else if (usagePercent > 65) statusLevel = "moderate";

    const platformName = os.platform() === "win32" ? "Windows" : os.platform() === "darwin" ? "macOS" : "Linux";

    const message = `Boss, system status ${statusLevel.toUpperCase()} hai: RAM usage ${usagePercent}% (${usedGB}GB / ${totalGB}GB), CPU me ${coreCount} cores active hain, aur system ${uptimeHrs} hours se running hai.`;

    return {
      success: true,
      platform: `${platformName} (${os.release()})`,
      osRelease: os.release(),
      hostname: os.hostname(),
      arch: os.arch(),
      uptimeHours: `${uptimeHrs} hrs`,
      cpu: {
        model: cpuModel,
        cores: coreCount,
        speedMHz: cpuSpeed,
        loadAverage: loadAvg,
      },
      memory: {
        totalGB: `${totalGB} GB`,
        usedGB: `${usedGB} GB`,
        freeGB: `${freeGB} GB`,
        usagePercent,
      },
      statusLevel,
      message,
    };
  }
}

export const systemHealthService = new SystemHealthService();
