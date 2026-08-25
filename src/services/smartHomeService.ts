export interface SmartDeviceState {
  id: string;
  name: string;
  type: "light" | "smart_plug" | "ac" | "fan" | "tv";
  isOn: boolean;
  brightnessPercent?: number;
  temperatureC?: number;
  speedLevel?: number;
  room: string;
}

class SmartHomeService {
  private devices: Map<string, SmartDeviceState> = new Map([
    ["desk_light", { id: "desk_light", name: "Desk Light", type: "light", isOn: true, brightnessPercent: 80, room: "Work Desk" }],
    ["room_light", { id: "room_light", name: "Ceiling Lights", type: "light", isOn: true, brightnessPercent: 100, room: "Bedroom" }],
    ["ac_unit", { id: "ac_unit", name: "Air Conditioner", type: "ac", isOn: true, temperatureC: 24, room: "Bedroom" }],
    ["smart_plug_pc", { id: "smart_plug_pc", name: "PC Power Socket", type: "smart_plug", isOn: true, room: "Work Desk" }],
    ["fan", { id: "fan", name: "Ceiling Fan", type: "fan", isOn: true, speedLevel: 3, room: "Bedroom" }],
  ]);

  public controlDevice(
    deviceNameOrRoom: string,
    action: "turn_on" | "turn_off" | "toggle" | "set_temp" | "set_brightness",
    value?: number
  ): { success: boolean; device: SmartDeviceState; message: string } {
    const raw = (deviceNameOrRoom || "").toLowerCase().trim();
    let targetDevice: SmartDeviceState | undefined;

    for (const d of this.devices.values()) {
      if (raw.includes(d.id) || raw.includes(d.name.toLowerCase()) || raw.includes(d.type) || raw.includes(d.room.toLowerCase())) {
        targetDevice = d;
        break;
      }
    }

    if (!targetDevice) {
      targetDevice = this.devices.get("desk_light")!;
    }

    if (action === "turn_on") {
      targetDevice.isOn = true;
    } else if (action === "turn_off") {
      targetDevice.isOn = false;
    } else if (action === "toggle") {
      targetDevice.isOn = !targetDevice.isOn;
    } else if (action === "set_temp" && value) {
      targetDevice.temperatureC = value;
      targetDevice.isOn = true;
    } else if (action === "set_brightness" && value) {
      targetDevice.brightnessPercent = value;
      targetDevice.isOn = true;
    }

    let message = `Boss, ${targetDevice.name} (${targetDevice.room}) ko ${targetDevice.isOn ? "ON" : "OFF"} kar diya gaya hai!`;
    if (action === "set_temp") {
      message = `Boss, AC ka temperature ${targetDevice.temperatureC}°C par set kar diya gaya hai!`;
    } else if (action === "set_brightness") {
      message = `Boss, ${targetDevice.name} ki brightness ${targetDevice.brightnessPercent}% par set kar di hai!`;
    }

    return {
      success: true,
      device: targetDevice,
      message,
    };
  }

  public getHomeStatus(): { success: boolean; devices: SmartDeviceState[]; message: string } {
    const devList = Array.from(this.devices.values());
    const onCount = devList.filter((d) => d.isOn).length;
    const message = `Boss, Smart Home Status: Total ${devList.length} devices connected hain, jisme se ${onCount} devices abhi ON hain. (AC: 24°C, Desk Lights: 80%).`;

    return {
      success: true,
      devices: devList,
      message,
    };
  }
}

export const smartHomeService = new SmartHomeService();
