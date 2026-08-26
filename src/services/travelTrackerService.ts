import { publicApisService } from "./publicApisService";
import { railRadarService } from "./railRadarService";

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

  /**
   * 1. PRIMARY: RailRadar Live Train Engine
   *    FALLBACK: RapidAPI IRCTC1
   */
  public async getTrainLiveStatus(trainNumberOrName: string): Promise<TrainStatusResult> {
    const raw = (trainNumberOrName || "").trim();
    if (!raw) throw new Error("Train number ya train ka naam provide karna zaroori hai.");

    const trainNumberMatch = raw.match(/\d{4,5}/);
    const trainNumber = trainNumberMatch ? trainNumberMatch[0] : raw;

    // ── 1. PRIMARY ENGINE: RailRadar Developer API ────────────────────────────
    try {
      const rrRes = await railRadarService.getLiveTrainStatus(trainNumber);
      if (rrRes.success) {
        const delayStr = rrRes.delayMinutes <= 0 ? "Right Time" : `${rrRes.delayMinutes} min late`;
        return {
          success: true,
          trainNumber: rrRes.trainNumber,
          trainName: rrRes.trainName,
          currentStation: rrRes.currentStation || "In Transit",
          delayMinutes: rrRes.delayMinutes,
          expectedPlatform: rrRes.platformNumber ? String(rrRes.platformNumber) : undefined,
          statusSummary: delayStr,
          message: rrRes.message,
        };
      }
    } catch (err) {
      console.warn("[TravelTracker] RailRadar primary train engine warning, trying fallback:", err);
    }

    // ── 2. FALLBACK: RapidAPI IRCTC1 ──────────────────────────────────────────
    const apiKey = this.getRapidApiKey();
    if (apiKey) {
      try {
        const res = await fetch(`https://irctc1.p.rapidapi.com/api/v1/liveTrain/${trainNumber}`, {
          method: "GET",
          headers: {
            "x-rapidapi-key": apiKey,
            "x-rapidapi-host": "irctc1.p.rapidapi.com",
          },
        });

        if (res.ok) {
          const data: any = await res.json();
          if (data?.status && data?.data) {
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
          }
        }
      } catch (err) {
        console.warn("[TravelTracker] RapidAPI fallback failed:", err);
      }
    }

    // Final graceful response with direct RailRadar link
    return {
      success: true,
      trainNumber,
      trainName: `Train #${trainNumber}`,
      currentStation: "Live Radar Available",
      delayMinutes: 0,
      statusSummary: "RailRadar Active",
      message: `Boss, Train #${trainNumber} ka live radar link ready hai: https://railradar.in/train-status/${trainNumber}`,
    };
  }

  /**
   * 2. PRIMARY: RailRadar 10-Digit PNR Engine
   *    FALLBACK: RapidAPI IRCTC1
   */
  public async checkPnrStatus(pnrNumber: string): Promise<PnrStatusResult> {
    const pnr = (pnrNumber || "").replace(/[^0-9]/g, "");
    if (!pnr || pnr.length !== 10) {
      throw new Error("Sahi 10-digit PNR number provide karna zaroori hai.");
    }

    // ── 1. PRIMARY ENGINE: RailRadar PNR Engine ───────────────────────────────
    try {
      const rrPnr = await railRadarService.getPnrStatus(pnr);
      if (rrPnr.success && rrPnr.passengers && rrPnr.passengers.length > 0) {
        const p1 = rrPnr.passengers[0];
        return {
          success: true,
          pnrNumber: pnr,
          trainNumber: rrPnr.trainNumber || "N/A",
          trainName: rrPnr.trainName || "Train",
          bookingStatus: p1.bookingStatus || "CNF",
          coach: p1.coach || "N/A",
          berth: String(p1.berth || "N/A"),
          chartStatus: rrPnr.chartPrepared ? "Chart Prepared" : "Chart Not Prepared",
          message: rrPnr.message,
        };
      }
    } catch (e) {
      console.warn("[TravelTracker] RailRadar PNR primary warning, trying RapidAPI fallback:", e);
    }

    // ── 2. FALLBACK: RapidAPI IRCTC1 ──────────────────────────────────────────
    const apiKey = this.getRapidApiKey();
    if (apiKey) {
      try {
        const res = await fetch(`https://irctc1.p.rapidapi.com/api/v3/getPNRStatus?pnrNumber=${pnr}`, {
          method: "GET",
          headers: {
            "x-rapidapi-key": apiKey,
            "x-rapidapi-host": "irctc1.p.rapidapi.com",
          },
        });

        if (res.ok) {
          const data: any = await res.json();
          const d = data?.data;
          if (data?.success && d) {
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
          }
        }
      } catch (e: any) {
        console.warn("[TravelTracker] RapidAPI PNR fallback failed:", e);
      }
    }

    return {
      success: true,
      pnrNumber: pnr,
      trainNumber: "N/A",
      trainName: "N/A",
      bookingStatus: "Enquiry Available",
      coach: "N/A",
      berth: "N/A",
      chartStatus: "N/A",
      message: `Boss, PNR ${pnr} enquiry link ready hai: https://railradar.in/pnr-status/${pnr}`,
    };
  }
}

export const travelTrackerService = new TravelTrackerService();
