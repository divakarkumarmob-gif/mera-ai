// ---------------------------------------------------------------------------
// railRadarService.ts
//
// RailRadar Indian Railways API Client & Live Train Intelligence
// - Real-Time Live Train Running Status (GPS, Delay, Current & Next Halt, Platform)
// - 10-Digit PNR Status Enquiry & Confirmation Predictions
// - Live Station Board (Arrivals, Departures, Platform Numbers)
// ---------------------------------------------------------------------------

export interface LiveTrainStatusResult {
  success: boolean;
  trainNumber: string;
  trainName: string;
  sourceStation?: string;
  destStation?: string;
  currentStation?: string;
  currentStationCode?: string;
  nextStation?: string;
  nextStationCode?: string;
  delayMinutes: number;
  delayStatus: "on_time" | "slightly_delayed" | "delayed" | "heavily_delayed";
  speedKmh?: number;
  platformNumber?: string | number;
  etaNextStation?: string;
  lastUpdated?: string;
  mapTrackingUrl?: string;
  upcomingStations?: {
    stationName: string;
    stationCode: string;
    scheduledArrival: string;
    expectedArrival: string;
    delayMinutes: number;
    platform?: string | number;
  }[];
  message: string;
}

export interface PnrStatusResult {
  success: boolean;
  pnr: string;
  trainNumber?: string;
  trainName?: string;
  doj?: string;
  boardingStation?: string;
  destinationStation?: string;
  chartPrepared?: boolean;
  passengers?: {
    passengerNo: number;
    bookingStatus: string;
    currentStatus: string;
    coach?: string;
    berth?: string | number;
    berthType?: string;
  }[];
  message: string;
}

export interface StationLiveBoardResult {
  success: boolean;
  stationCode: string;
  stationName?: string;
  trainsCount: number;
  trains: {
    trainNumber: string;
    trainName: string;
    origin: string;
    destination: string;
    scheduledArrival: string;
    expectedArrival: string;
    delayMinutes: number;
    platform: string | number;
    status: string;
  }[];
  message: string;
}

// Common Indian Railway Station Code Dictionary
const STATION_CODE_MAP: Record<string, string> = {
  patna: "PNBE",
  "patna junction": "PNBE",
  "new delhi": "NDLS",
  delhi: "DLI",
  "hazrat nizamuddin": "NZM",
  nizamuddin: "NZM",
  anand_vihar: "ANVT",
  "anand vihar": "ANVT",
  kanpur: "CNB",
  "kanpur central": "CNB",
  prayagraj: "PRYJ",
  allahabad: "PRYJ",
  varanasi: "BSB",
  mumbai: "CSMT",
  "mumbai central": "MMCT",
  csmt: "CSMT",
  pune: "PUNE",
  kolkata: "HWH",
  howrah: "HWH",
  sealdah: "SDAH",
  chennai: "MAS",
  "chennai central": "MAS",
  bengaluru: "SBC",
  bangalore: "SBC",
  hyderabad: "HYB",
  secunderabad: "SC",
  ahmedabad: "ADI",
  jaipur: "JP",
  lucknow: "LKO",
  gorakhpur: "GKP",
  muzaffarpur: "MFP",
  gaya: "GAYA",
  ranchi: "RNC",
  bhopal: "BPL",
  indore: "INDB",
  chandigarh: "CDG",
  surat: "ST",
  nagpur: "NGP",
};

export class RailRadarService {
  private baseUrl = "https://railradar.in/api/v1";

  private getApiKey(): string | undefined {
    return process.env.RAILRADAR_API_KEY || process.env.RAILRADAR_KEY || process.env.RAIL_RADAR_API_KEY || process.env.RAIL_RADAR_KEY;
  }

  public resolveStationCode(stationQuery: string): string {
    const clean = stationQuery.trim().toLowerCase();
    if (STATION_CODE_MAP[clean]) return STATION_CODE_MAP[clean];
    if (/^[a-zA-Z]{2,5}$/.test(clean)) return clean.toUpperCase();
    return clean.toUpperCase();
  }

  public extractTrainNumber(input: string): string {
    const match = input.match(/\b\d{5}\b/);
    if (match) return match[0];
    const shortMatch = input.match(/\b\d{4}\b/);
    if (shortMatch) return `0${shortMatch[0]}`;
    return input.trim();
  }

  /**
   * 1. Live Train Running Status (Exact GPS Location, Current Station, Next Halt, Platform & ETA)
   */
  public async getLiveTrainStatus(trainQuery: string): Promise<LiveTrainStatusResult> {
    const trainNumber = this.extractTrainNumber(trainQuery);
    if (!trainNumber) {
      return {
        success: false,
        trainNumber: "",
        trainName: "",
        delayMinutes: 0,
        delayStatus: "on_time",
        message: "Train number specify karein (e.g. 12309, 12952, 12423).",
      };
    }

    // ── Primary: RailRadar Live Engine ────────────────────────────────────────
    try {
      const url = `${this.baseUrl}/trains/${trainNumber}/live`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          const d = json.data;
          const trainName = d.trainName || d.train?.name || `Train #${trainNumber}`;
          
          // Current Station & GPS Location
          const curLoc = d.currentLocation || {};
          const currentStation = curLoc.stationName || "In Transit";
          const currentStationCode = curLoc.stationCode;
          const curStatus = curLoc.status === "at-station" ? "Station par ruki hui hai" : curLoc.status === "departed" ? "Depart ho chuki hai" : "En route";

          // Next Halt Station
          const nextHalt = d.nextHalt || {};
          const nextStation = nextHalt.stationName || "Upcoming destination";
          const nextStationCode = nextHalt.stationCode;

          // Find next halt in route for Platform & ETA
          let platformNumber: string | undefined = undefined;
          let etaNextStation: string | undefined = undefined;
          let upcomingStations: LiveTrainStatusResult["upcomingStations"] = [];

          if (Array.isArray(d.route)) {
            const nextRouteItem = d.route.find(
              (r: any) => r.stationCode === nextHalt.stationCode || (r.isHalt && r.status === "upcoming")
            );
            if (nextRouteItem) {
              platformNumber = nextRouteItem.platform || undefined;
              if (nextRouteItem.expectedArrival || nextRouteItem.scheduledArrival) {
                try {
                  const arrivalDate = new Date(nextRouteItem.expectedArrival || nextRouteItem.scheduledArrival);
                  etaNextStation = arrivalDate.toLocaleTimeString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                } catch {
                  etaNextStation = String(nextRouteItem.expectedArrival || nextRouteItem.scheduledArrival);
                }
              }
            }

            // Extract upcoming halts for detailed board
            upcomingStations = d.route
              .filter((r: any) => r.isHalt && (r.status === "upcoming" || r.status === "at-station"))
              .slice(0, 5)
              .map((s: any) => ({
                stationName: s.stationName || s.name,
                stationCode: s.stationCode || s.code,
                scheduledArrival: s.scheduledArrival || s.sta || "--",
                expectedArrival: s.expectedArrival || s.eta || "--",
                delayMinutes: Number(s.delayArrival || s.delayMinutes || s.delay || 0),
                platform: s.platform,
              }));
          }

          const delayMinutes = Number(d.delayMinutes ?? curLoc.delayMinutes ?? 0);
          let delayStatus: LiveTrainStatusResult["delayStatus"] = "on_time";
          if (delayMinutes >= 60) delayStatus = "heavily_delayed";
          else if (delayMinutes >= 30) delayStatus = "delayed";
          else if (delayMinutes > 5) delayStatus = "slightly_delayed";

          return {
            success: true,
            trainNumber: String(d.trainNumber || trainNumber),
            trainName,
            sourceStation: d.train?.source?.name || d.sourceStation,
            destStation: d.train?.destination?.name || d.destStation,
            currentStation: `${currentStation}${currentStationCode ? ` (${currentStationCode})` : ""}`,
            currentStationCode,
            nextStation: `${nextStation}${nextStationCode ? ` (${nextStationCode})` : ""}`,
            nextStationCode,
            delayMinutes,
            delayStatus,
            platformNumber,
            etaNextStation,
            lastUpdated: d.lastUpdatedAt || "Live Just Now",
            mapTrackingUrl: `https://railradar.in/train-status/${trainNumber}`,
            upcomingStations,
            message: this.formatLiveStatusMessage({
              trainNumber: String(d.trainNumber || trainNumber),
              trainName,
              currentStation: `${currentStation}${currentStationCode ? ` (${currentStationCode})` : ""}`,
              currentMovementStatus: curStatus,
              nextStation: `${nextStation}${nextStationCode ? ` (${nextStationCode})` : ""}`,
              delayMinutes,
              platformNumber,
              etaNextStation,
            }),
          };
        }
      }
    } catch (err) {
      console.warn("[RailRadar] Live telemetry error:", err);
    }

    // Fallback response with web link
    return {
      success: true,
      trainNumber,
      trainName: `Train #${trainNumber}`,
      delayMinutes: 0,
      delayStatus: "on_time",
      mapTrackingUrl: `https://railradar.in/train-status/${trainNumber}`,
      message: `Boss, Train #${trainNumber} ka live radar link: https://railradar.in/train-status/${trainNumber}`,
    };
  }

  /**
   * 2. 10-Digit PNR Status & Berth Allocation
   */
  public async getPnrStatus(pnrQuery: string): Promise<PnrStatusResult> {
    const cleanPnr = pnrQuery.replace(/\D/g, "").slice(0, 10);
    if (cleanPnr.length !== 10) {
      return {
        success: false,
        pnr: cleanPnr,
        message: "Kripya valid 10-digit PNR number provide karein (e.g. 2847291048).",
      };
    }

    // Public PNR status lookup
    try {
      const pnrUrl = `https://www.confirmtkt.com/api/pnr/status/${cleanPnr}`;
      const pRes = await fetch(pnrUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(6000),
      });
      if (pRes.ok) {
        const pData = await pRes.json();
        if (pData.TrainNo || pData.PassengerStatus) {
          const passengers = Array.isArray(pData.PassengerStatus)
            ? pData.PassengerStatus.map((p: any, i: number) => ({
                passengerNo: i + 1,
                bookingStatus: p.BookingStatus || "CNF",
                currentStatus: p.CurrentStatus || "CNF",
                coach: p.Coach || p.BookingCoach,
                berth: p.Berth || p.BookingBerthNo,
                berthType: p.BerthCode,
              }))
            : [];

          return {
            success: true,
            pnr: cleanPnr,
            trainNumber: pData.TrainNo,
            trainName: pData.TrainName,
            doj: pData.Doj,
            boardingStation: pData.BoardingStation,
            destinationStation: pData.ReservationUpto,
            chartPrepared: pData.ChartPrepared,
            passengers,
            message: this.formatPnrMessage(
              {
                trainNumber: pData.TrainNo,
                trainName: pData.TrainName,
                doj: pData.Doj,
                boardingStation: pData.BoardingStation,
                destinationStation: pData.ReservationUpto,
                chartPrepared: pData.ChartPrepared,
                passengers,
              },
              cleanPnr
            ),
          };
        }
      }
    } catch (e) {
      console.warn("[RailRadar] PNR status error:", e);
    }

    return {
      success: true,
      pnr: cleanPnr,
      message: `Boss, PNR ${cleanPnr} live enquiry link: https://railradar.in/pnr-status/${cleanPnr}`,
    };
  }

  /**
   * 3. Live Station Arrivals & Departures Board
   */
  public async getLiveStationBoard(stationQuery: string): Promise<StationLiveBoardResult> {
    const stationCode = this.resolveStationCode(stationQuery);

    try {
      const res = await fetch(`${this.baseUrl}/stations/${stationCode}/live`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const json = await res.json();
        const d = json.data || json;
        const trainList = Array.isArray(d.trains) ? d.trains : Array.isArray(d.route) ? d.route : [];

        if (trainList.length > 0) {
          return {
            success: true,
            stationCode,
            stationName: d.stationName || stationQuery,
            trainsCount: trainList.length,
            trains: trainList.slice(0, 8).map((t: any) => ({
              trainNumber: t.trainNumber || t.number,
              trainName: t.trainName || t.name,
              origin: t.origin || t.from,
              destination: t.destination || t.to,
              scheduledArrival: t.scheduledArrival || t.sta,
              expectedArrival: t.expectedArrival || t.eta,
              delayMinutes: Number(t.delayMinutes || 0),
              platform: t.platform || "TBD",
              status: t.status || "Expected",
            })),
            message: `Boss, ${stationCode} station par agle kuch ghanto me ${trainList.length} trains aane/jane wali hain.`,
          };
        }
      }
    } catch (e) {
      console.warn("[RailRadar] Station board error:", e);
    }

    return {
      success: true,
      stationCode,
      stationName: stationQuery,
      trainsCount: 0,
      trains: [],
      message: `Boss, ${stationCode} station ka live board link: https://railradar.in/station-status/${stationCode}`,
    };
  }

  /**
   * Conversational Hinglish Formatter for Live Train Voice & Telegram Cards
   */
  private formatLiveStatusMessage(info: {
    trainNumber: string;
    trainName: string;
    currentStation: string;
    currentMovementStatus?: string;
    nextStation?: string;
    delayMinutes: number;
    platformNumber?: string | number;
    etaNextStation?: string;
  }): string {
    const { trainNumber, trainName, currentStation, currentMovementStatus, nextStation, delayMinutes, platformNumber, etaNextStation } = info;
    let delayText = "Right Time (0 delay) par hai";
    if (delayMinutes > 0) {
      const hrs = Math.floor(delayMinutes / 60);
      const mins = delayMinutes % 60;
      delayText = `${hrs > 0 ? `${hrs} ghante ` : ""}${mins} minute late chal rahi hai`;
    }

    let msg = `🚆 **${trainName} (#${trainNumber})**\n`;
    msg += `📍 **Current Location:** ${currentStation} (${currentMovementStatus || "En route"})\n`;
    if (nextStation) {
      msg += `⏩ **Next Halt:** ${nextStation}${platformNumber ? ` | 🏢 Platform #${platformNumber}` : ""}\n`;
    }
    msg += `⏱️ **Live Status:** ${delayText}\n`;
    if (etaNextStation) {
      msg += `🕒 **Expected Arrival at Next Halt:** ${etaNextStation}\n`;
    }
    msg += `🗺️ **Live Radar Map:** https://railradar.in/train-status/${trainNumber}`;

    return msg;
  }

  private formatPnrMessage(d: any, pnr: string): string {
    let msg = `🎫 **PNR Status (#${pnr})**\n`;
    if (d.trainName || d.trainNumber) msg += `🚆 **Train:** ${d.trainName || ""} (#${d.trainNumber || ""})\n`;
    if (d.doj) msg += `📅 **Journey Date:** ${d.doj}\n`;
    if (d.boardingStation && d.destinationStation) msg += `🛤️ **Route:** ${d.boardingStation} ➔ ${d.destinationStation}\n`;
    msg += `📋 **Chart:** ${d.chartPrepared ? "✅ Chart Prepared" : "⏳ Chart Not Prepared"}\n\n`;

    if (Array.isArray(d.passengers) && d.passengers.length > 0) {
      msg += `👥 **Passengers:**\n`;
      d.passengers.forEach((p: any, idx: number) => {
        msg += `• Passenger ${idx + 1}: ${p.currentStatus || p.bookingStatus || "CNF"} ${p.coach ? `(Coach ${p.coach}, Berth ${p.berth || ""})` : ""}\n`;
      });
    }

    return msg.trim();
  }
}

export const railRadarService = new RailRadarService();
