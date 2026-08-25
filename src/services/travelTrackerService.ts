import { publicApisService } from "./publicApisService";

export interface TrainStatusResult {
  success: boolean;
  trainNumber: string;
  trainName: string;
  currentStation: string;
  delayMinutes: number;
  expectedPlatform?: string;
  statusSummary: string;
  message: string;
}

export interface PnrStatusResult {
  success: boolean;
  pnrNumber: string;
  trainNumber: string;
  trainName: string;
  bookingStatus: string;
  coach: string;
  berth: string;
  chartStatus: string;
  message: string;
}

class TravelTrackerService {
  private getRapidApiKey(): string | null {
    return process.env.RAPIDAPI_KEY || null;
  }

  public async getTrainLiveStatus(trainNumberOrName: string): Promise<TrainStatusResult> {
    const raw = (trainNumberOrName || "").trim();
    if (!raw) throw new Error("Train number ya train ka naam provide karna zaroori hai.");

    const trainNumberMatch = raw.match(/\d{4,5}/);
    const trainNumber = trainNumberMatch ? trainNumberMatch[0] : raw;

    const apiKey = this.getRapidApiKey();
    if (!apiKey) {
      console.error("[TravelTracker] SECURITY/DATA: RAPIDAPI_KEY not configured — cannot fetch real train status.");
      return {
        success: false,
        trainNumber,
        trainName: "Unknown",
        currentStation: "Unknown",
        delayMinutes: 0,
        statusSummary: "Live tracking unavailable",
        message: `Boss, live train tracking abhi configure nahi hai (RAPIDAPI_KEY missing .env me). Kripya IRCTC1 API key RapidAPI se lekar .env me daalein.`,
      };
    }

    try {
      const res = await fetch(`https://irctc1.p.rapidapi.com/api/v1/liveTrain/${trainNumber}`, {
        method: "GET",
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": "irctc1.p.rapidapi.com",
        },
      });

      if (!res.ok) {
        throw new Error(`IRCTC1 API returned status ${res.status}`);
      }

      const data: any = await res.json();
      if (!data?.status || !data?.data) {
        return {
          success: false,
          trainNumber,
          trainName: "Unknown",
          currentStation: "Unknown",
          delayMinutes: 0,
          statusSummary: "Not found",
          message: `Boss, Train #${trainNumber} ka live status nahi mil paya. Kripya train number check karein.`,
        };
      }

      const d = data.data;
      const delayMinutes = Number(d.delay) || 0;
      const currentStation = d.current_station_name || d.currentStationName || "En route";
      const trainName = d.train_name || `Train ${trainNumber}`;
      const platform = d.platform_number ? `Platform ${d.platform_number}` : undefined;
      const delayStr = delayMinutes <= 0 ? "Right Time (On Schedule)" : `${delayMinutes} Minutes Late`;

      return {
        success: true,
        trainNumber,
        trainName,
        currentStation,
        delayMinutes,
        expectedPlatform: platform,
        statusSummary: delayStr,
        message: `Boss, Train #${trainNumber} (${trainName}) ka LIVE status: Abhi ${currentStation} ke pass hai, ${delayStr}.${platform ? ` Expected Platform: ${platform}.` : ""} (Source: IRCTC live data)`,
      };
    } catch (e: any) {
      console.error("[TravelTracker] getTrainLiveStatus failed:", e);
      return {
        success: false,
        trainNumber,
        trainName: "Unknown",
        currentStation: "Unknown",
        delayMinutes: 0,
        statusSummary: "Error",
        message: `Boss, live train status fetch karte waqt error aaya: ${e?.message || "unknown error"}.`,
      };
    }
  }

  public async checkPnrStatus(pnrNumber: string): Promise<PnrStatusResult> {
    const pnr = (pnrNumber || "").replace(/[^0-9]/g, "");
    if (!pnr || pnr.length !== 10) {
      throw new Error("Sahi 10-digit PNR number provide karna zaroori hai.");
    }

    const apiKey = this.getRapidApiKey();
    if (!apiKey) {
      console.error("[TravelTracker] SECURITY/DATA: RAPIDAPI_KEY not configured — cannot fetch real PNR status.");
      return {
        success: false,
        pnrNumber: pnr,
        trainNumber: "Unknown",
        trainName: "Unknown",
        bookingStatus: "Unavailable",
        coach: "-",
        berth: "-",
        chartStatus: "Unavailable",
        message: `Boss, PNR status check abhi configure nahi hai (RAPIDAPI_KEY missing .env me). Kripya IRCTC1 API key RapidAPI se lekar .env me daalein.`,
      };
    }

    try {
      const res = await fetch(`https://irctc1.p.rapidapi.com/api/v3/getPNRStatus?pnrNumber=${pnr}`, {
        method: "GET",
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": "irctc1.p.rapidapi.com",
        },
      });

      if (!res.ok) {
        throw new Error(`IRCTC1 API returned status ${res.status}`);
      }

      const data: any = await res.json();
      const d = data?.data;
      if (!data?.success || !d) {
        return {
          success: false,
          pnrNumber: pnr,
          trainNumber: "Unknown",
          trainName: "Unknown",
          bookingStatus: "Not found",
          coach: "-",
          berth: "-",
          chartStatus: "Unknown",
          message: `Boss, PNR ${pnr} ke liye koi booking record nahi mila. Kripya PNR number check karein.`,
        };
      }

      const passenger = Array.isArray(d.passengerList) && d.passengerList.length > 0 ? d.passengerList[0] : null;
      const bookingStatus = passenger?.currentStatusDetails || passenger?.bookingStatusDetails || "Unknown";
      const coach = passenger?.currentCoachId || "-";
      const berth = passenger?.currentBerthNo ? `${passenger.currentBerthNo} (${passenger.currentBerthCode || ""})`.trim() : "-";

      return {
        success: true,
        pnrNumber: pnr,
        trainNumber: d.trainNumber || "Unknown",
        trainName: d.trainName || "Unknown",
        bookingStatus,
        coach,
        berth,
        chartStatus: d.chartStatus || "Unknown",
        message: `Boss, PNR ${pnr} ka LIVE status: ${bookingStatus}. Coach: ${coach}, Berth: ${berth}. Charting Status: ${d.chartStatus || "Unknown"}. (Source: IRCTC live data)`,
      };
    } catch (e: any) {
      console.error("[TravelTracker] checkPnrStatus failed:", e);
      return {
        success: false,
        pnrNumber: pnr,
        trainNumber: "Unknown",
        trainName: "Unknown",
        bookingStatus: "Error",
        coach: "-",
        berth: "-",
        chartStatus: "Error",
        message: `Boss, PNR status check karte waqt error aaya: ${e?.message || "unknown error"}.`,
      };
    }
  }
}

export const travelTrackerService = new TravelTrackerService();
