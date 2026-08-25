export interface SmartDeviceState {
  id: string; // Home Assistant entity_id, e.g. "light.desk_light"
  name: string;
  type: "light" | "smart_plug" | "ac" | "fan" | "tv" | "other";
  isOn: boolean;
  brightnessPercent?: number;
  temperatureC?: number;
  speedLevel?: number;
  room: string;
}

/**
 * Smart Home control via Home Assistant's REST API.
 * Home Assistant (https://www.home-assistant.io) acts as a single hub in
 * front of real WiFi devices — bulbs, smart plugs, ACs, TVs, and Alexa/Google
 * Home routines — regardless of brand, so this one integration controls
 * whatever is actually connected to it.
 *
 * Setup required (do this once):
 * 1. Install Home Assistant (Raspberry Pi, home server, or a small cloud VM).
 * 2. Add your real devices to it (each brand has a Home Assistant integration —
 *    Philips Hue, TP-Link Kasa, Govee, LG/Samsung TV, Alexa Media Player, etc.).
 * 3. In Home Assistant: Profile -> Security -> Long-Lived Access Tokens -> Create Token.
 * 4. Set in .env:
 *      HOME_ASSISTANT_URL=http://<your-ha-ip>:8123
 *      HOME_ASSISTANT_TOKEN=<the long-lived token>
 *
 * Until those are set, every call below returns a clear "not configured"
 * response instead of fake/simulated device data.
 */
class SmartHomeService {
  private getConfig(): { url: string; token: string } | null {
    const url = process.env.HOME_ASSISTANT_URL;
    const token = process.env.HOME_ASSISTANT_TOKEN;
    if (!url || !token) return null;
    return { url: url.replace(/\/+$/, ""), token };
  }

  private mapDomainToType(domain: string, entityId: string): SmartDeviceState["type"] {
    if (domain === "light") return "light";
    if (domain === "switch") return entityId.includes("ac") || entityId.includes("climate") ? "ac" : "smart_plug";
    if (domain === "climate") return "ac";
    if (domain === "fan") return "fan";
    if (domain === "media_player") return "tv";
    return "other";
  }

  private toDeviceState(entity: any): SmartDeviceState {
    const entityId: string = entity.entity_id;
    const domain = entityId.split(".")[0];
    const attrs = entity.attributes || {};
    const isOn = ["on", "playing", "home", "cool", "heat"].includes(String(entity.state).toLowerCase());

    return {
      id: entityId,
      name: attrs.friendly_name || entityId,
      type: this.mapDomainToType(domain, entityId),
      isOn,
      brightnessPercent: attrs.brightness != null ? Math.round((Number(attrs.brightness) / 255) * 100) : undefined,
      temperatureC: attrs.temperature != null ? Number(attrs.temperature) : undefined,
      speedLevel: attrs.percentage != null ? Math.round(Number(attrs.percentage) / 25) : undefined,
      room: attrs.area_id || attrs.room || "Unknown",
    };
  }

  /**
   * Finds the best-matching real Home Assistant entity for a spoken device
   * name / room (e.g. "bedroom light", "TV", "AC"). Fetches the full entity
   * list live from Home Assistant rather than any fixed local list, so it
   * reflects whatever devices are actually connected right now.
   */
  private async findEntity(deviceNameOrRoom: string, cfg: { url: string; token: string }): Promise<any | null> {
    const raw = (deviceNameOrRoom || "").toLowerCase().trim();
    const res = await fetch(`${cfg.url}/api/states`, {
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Home Assistant /api/states returned ${res.status}`);

    const entities: any[] = await res.json();
    const controllable = entities.filter((e) =>
      ["light", "switch", "climate", "fan", "media_player"].includes(e.entity_id.split(".")[0])
    );

    return (
      controllable.find((e) => {
        const friendly = String(e.attributes?.friendly_name || "").toLowerCase();
        const area = String(e.attributes?.area_id || e.attributes?.room || "").toLowerCase();
        return raw.includes(e.entity_id.toLowerCase()) || raw.includes(friendly) || (area && raw.includes(area)) || friendly.includes(raw);
      }) || null
    );
  }

  public async controlDevice(
    deviceNameOrRoom: string,
    action: "turn_on" | "turn_off" | "toggle" | "set_temp" | "set_brightness",
    value?: number
  ): Promise<{ success: boolean; device?: SmartDeviceState; message: string }> {
    const cfg = this.getConfig();
    if (!cfg) {
      console.error("[SmartHome] HOME_ASSISTANT_URL / HOME_ASSISTANT_TOKEN not configured.");
      return {
        success: false,
        message:
          "Boss, smart home control abhi configure nahi hai. Home Assistant setup karke .env me HOME_ASSISTANT_URL aur HOME_ASSISTANT_TOKEN daalein, phir real devices control ho sakenge.",
      };
    }

    try {
      const entity = await this.findEntity(deviceNameOrRoom, cfg);
      if (!entity) {
        return {
          success: false,
          message: `Boss, "${deviceNameOrRoom}" naam ka koi connected device Home Assistant me nahi mila. Pehle Home Assistant me device add karein.`,
        };
      }

      const domain = entity.entity_id.split(".")[0];
      let service = "";
      let serviceData: any = { entity_id: entity.entity_id };

      if (action === "turn_on") {
        service = `${domain}/turn_on`;
      } else if (action === "turn_off") {
        service = `${domain}/turn_off`;
      } else if (action === "toggle") {
        service = `${domain}/toggle`;
      } else if (action === "set_temp" && value != null) {
        service = "climate/set_temperature";
        serviceData.temperature = value;
      } else if (action === "set_brightness" && value != null) {
        service = "light/turn_on";
        serviceData.brightness_pct = Math.max(0, Math.min(100, value));
      } else {
        return { success: false, message: "Boss, ye action is device type ke liye valid nahi hai." };
      }

      const callRes = await fetch(`${cfg.url}/api/services/${service}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(serviceData),
      });

      if (!callRes.ok) {
        throw new Error(`Home Assistant service call failed with status ${callRes.status}`);
      }

      // Re-fetch the entity's fresh state after the command
      const stateRes = await fetch(`${cfg.url}/api/states/${entity.entity_id}`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      const freshEntity = stateRes.ok ? await stateRes.json() : entity;
      const device = this.toDeviceState(freshEntity);

      let message = `Boss, ${device.name} ko ${device.isOn ? "ON" : "OFF"} kar diya gaya hai!`;
      if (action === "set_temp") {
        message = `Boss, ${device.name} ka temperature ${device.temperatureC}°C par set kar diya gaya hai!`;
      } else if (action === "set_brightness") {
        message = `Boss, ${device.name} ki brightness ${device.brightnessPercent}% par set kar di hai!`;
      }

      return { success: true, device, message };
    } catch (e: any) {
      console.error("[SmartHome] controlDevice failed:", e);
      return {
        success: false,
        message: `Boss, device control karte waqt error aaya: ${e?.message || "unknown error"}.`,
      };
    }
  }

  public async getHomeStatus(): Promise<{ success: boolean; devices: SmartDeviceState[]; message: string }> {
    const cfg = this.getConfig();
    if (!cfg) {
      console.error("[SmartHome] HOME_ASSISTANT_URL / HOME_ASSISTANT_TOKEN not configured.");
      return {
        success: false,
        devices: [],
        message:
          "Boss, smart home status abhi configure nahi hai. Home Assistant setup karke .env me HOME_ASSISTANT_URL aur HOME_ASSISTANT_TOKEN daalein.",
      };
    }

    try {
      const res = await fetch(`${cfg.url}/api/states`, {
        headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`Home Assistant /api/states returned ${res.status}`);

      const entities: any[] = await res.json();
      const controllable = entities.filter((e) =>
        ["light", "switch", "climate", "fan", "media_player"].includes(e.entity_id.split(".")[0])
      );
      const devices = controllable.map((e) => this.toDeviceState(e));
      const onCount = devices.filter((d) => d.isOn).length;

      const message =
        devices.length === 0
          ? "Boss, Home Assistant se connect ho gaya hoon lekin abhi koi controllable device add nahi hai."
          : `Boss, Smart Home Status: Total ${devices.length} real devices connected hain, jisme se ${onCount} abhi ON hain.`;

      return { success: true, devices, message };
    } catch (e: any) {
      console.error("[SmartHome] getHomeStatus failed:", e);
      return {
        success: false,
        devices: [],
        message: `Boss, smart home status fetch karte waqt error aaya: ${e?.message || "unknown error"}.`,
      };
    }
  }
}

export const smartHomeService = new SmartHomeService();
