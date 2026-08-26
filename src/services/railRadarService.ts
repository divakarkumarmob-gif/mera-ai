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

export interface TrainFareClass {
  classCode: string;
  className: string;
  totalFare: number;
  baseFare: number;
  cateringCharge?: number;
  dynamicFare?: number;
  gst?: number;
}

export interface TrainFareResult {
  success: boolean;
  trainNumber: string;
  trainName?: string;
  fromStation?: string;
  toStation?: string;
  journeyDate?: string;
  distanceKm?: number;
  fares: TrainFareClass[];
  message: string;
}

export interface CoachPositionResult {
  success: boolean;
  trainNumber: string;
  trainName?: string;
  rawPosition?: string;
  totalCoaches?: number;
  generalSummary?: string;
  sleeperSummary?: string;
  acSummary?: string;
  coaches?: string[];
  message: string;
}

export interface StoppageCheckResult {
  success: boolean;
  trainNumber: string;
  trainName?: string;
  targetStation: string;
  stops: boolean;
  stationName?: string;
  stationCode?: string;
  platform?: string | number;
  scheduledArrival?: string;
  scheduledDeparture?: string;
  message: string;
}

export interface TrainsBetweenResult {
  success: boolean;
  fromStation: string;
  toStation: string;
  trainsCount: number;
  trains: {
    trainNumber: string;
    trainName: string;
    scheduledDeparture?: string;
    expectedDeparture?: string;
    delayMinutes?: number;
    platform?: string | number;
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
   * 4. Train Ticket Price / Fare Breakdown by Class
   */
  public async getTrainFares(
    trainQuery: string,
    fromStation?: string,
    toStation?: string,
    journeyDate?: string
  ): Promise<TrainFareResult> {
    const trainNumber = this.extractTrainNumber(trainQuery);
    if (!trainNumber) {
      return {
        success: false,
        trainNumber: "",
        fares: [],
        message: "Train number specify karein (e.g. 12309, 12393).",
      };
    }

    let src = fromStation ? this.resolveStationCode(fromStation) : undefined;
    let dst = toStation ? this.resolveStationCode(toStation) : undefined;
    let trainName: string | undefined = undefined;

    // Auto-resolve source and destination from live route if not specified
    if (!src || !dst) {
      try {
        const liveInfo = await this.getLiveTrainStatus(trainNumber);
        if (liveInfo.success) {
          trainName = liveInfo.trainName;
          if (!src && liveInfo.sourceStation) src = this.resolveStationCode(liveInfo.sourceStation);
          if (!dst && liveInfo.destStation) dst = this.resolveStationCode(liveInfo.destStation);
        }
      } catch {}
    }

    // Defaults if still not found
    if (!src) src = "PNBE";
    if (!dst) dst = "NDLS";

    // Format date YYYY-MM-DD
    const travelDate = journeyDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const CLASS_NAMES: Record<string, string> = {
      "1A": "1st AC (1A)",
      "2A": "2nd AC (2A)",
      "3A": "3rd AC (3A)",
      "3E": "3rd AC Economy (3E)",
      SL: "Sleeper (SL)",
      CC: "AC Chair Car (CC)",
      EC: "Exec Chair Car (EC)",
      "2S": "2nd Sitting (2S)",
    };

    const targetClasses = ["SL", "3E", "3A", "2A", "1A", "CC", "EC", "2S"];
    const foundFares: TrainFareClass[] = [];
    let distanceKm: number | undefined = undefined;

    await Promise.allSettled(
      targetClasses.map(async (cls) => {
        try {
          const url = `${this.baseUrl}/trains/${trainNumber}/fare?from=${src}&to=${dst}&date=${travelDate}&class=${cls}`;
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(5000),
          });

          if (res.ok) {
            const json = await res.json();
            const d = json.data;
            if (d && d.breakdown?.totalFare) {
              if (!trainName && d.trainName) trainName = d.trainName;
              if (!distanceKm && d.distance) distanceKm = d.distance;

              foundFares.push({
                classCode: cls,
                className: CLASS_NAMES[cls] || cls,
                totalFare: d.breakdown.totalFare,
                baseFare: d.breakdown.baseFare || 0,
                cateringCharge: d.breakdown.cateringCharge,
                dynamicFare: d.breakdown.dynamicFare,
                gst: d.breakdown.goodsServiceTax,
              });
            }
          }
        } catch {}
      })
    );

    // Sort classes: SL -> 3E -> 3A -> 2A -> 1A -> CC -> EC -> 2S
    const orderMap: Record<string, number> = { "2S": 1, SL: 2, "3E": 3, "3A": 4, CC: 5, "2A": 6, "1A": 7, EC: 8 };
    foundFares.sort((a, b) => (orderMap[a.classCode] || 99) - (orderMap[b.classCode] || 99));

    const finalTrainName = trainName || `Train #${trainNumber}`;

    if (foundFares.length === 0) {
      return {
        success: true,
        trainNumber,
        trainName: finalTrainName,
        fromStation: src,
        toStation: dst,
        journeyDate: travelDate,
        fares: [],
        message: `Boss, Train #${trainNumber} (${src} ➔ ${dst}) ka ticket fare check link: https://railradar.in/train-fare/${trainNumber}`,
      };
    }

    let msg = `🎟️ **Ticket Price / Fares: ${finalTrainName} (#${trainNumber})**\n`;
    msg += `🛤️ **Route:** ${src} ➔ ${dst} | 📅 **Date:** ${travelDate}\n`;
    if (distanceKm) msg += `📏 **Distance:** ${distanceKm} KM\n\n`;
    msg += `💰 **Class Fares (IRCTC Official):**\n`;

    foundFares.forEach((f) => {
      let extra = "";
      if (f.cateringCharge && f.cateringCharge > 0) extra += ` (incl. ₹${f.cateringCharge} food)`;
      if (f.dynamicFare && f.dynamicFare > 0) extra += ` (incl. Dynamic ₹${f.dynamicFare})`;
      msg += `• **${f.className}:** ₹${f.totalFare}${extra}\n`;
    });

    msg += `\n🔗 **Book / Live Radar:** https://railradar.in/train-status/${trainNumber}`;

    return {
      success: true,
      trainNumber,
      trainName: finalTrainName,
      fromStation: src,
      toStation: dst,
      journeyDate: travelDate,
      distanceKm,
      fares: foundFares,
      message: msg,
    };
  }

  /**
   * 5. Coach Position & Composition (General aage hai ya peeche, Sleeper, AC sequence)
   */
  public async getCoachPosition(trainQuery: string): Promise<CoachPositionResult> {
    const trainNumber = this.extractTrainNumber(trainQuery);
    if (!trainNumber) {
      return {
        success: false,
        trainNumber: "",
        message: "Train number specify karein (e.g. 12393, 12309).",
      };
    }

    try {
      const url = `${this.baseUrl}/trains/${trainNumber}/live`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const json = await res.json();
        const d = json.data;
        const trainName = d?.trainName || d?.train?.name || `Train #${trainNumber}`;
        const rawPos: string | undefined = d?.route?.[0]?.coachPosition || d?.train?.coachPosition;

        if (rawPos) {
          const coaches = rawPos.split("-").map((c) => c.trim()).filter(Boolean);
          const generalIndices: number[] = [];
          const sleeperIndices: number[] = [];
          const acIndices: number[] = [];
          const pantryIndices: number[] = [];

          coaches.forEach((c, idx) => {
            const up = c.toUpperCase();
            if (up.includes("GEN") || up.includes("GS") || up === "2S" || up.includes("UR")) {
              generalIndices.push(idx + 1);
            } else if (/^S\d+$/.test(up)) {
              sleeperIndices.push(idx + 1);
            } else if (/^[ABHM]\d+$/.test(up) || up.includes("BE") || up === "CC" || up === "EC") {
              acIndices.push(idx + 1);
            } else if (up === "PC" || up.includes("PANTRY")) {
              pantryIndices.push(idx + 1);
            }
          });

          // Compute friendly position explanation
          let generalSummary = "General (Unreserved) coaches nahi mile";
          if (generalIndices.length > 0) {
            const frontGen = generalIndices.filter((pos) => pos <= 5);
            const rearGen = generalIndices.filter((pos) => pos > 15);
            if (frontGen.length > 0 && rearGen.length > 0) {
              generalSummary = `Front (Engine ke theek peeche: ${frontGen.length} coaches) aur Rear (Guard dibbe ke aage: ${rearGen.length} coaches) dono side hain`;
            } else if (frontGen.length > 0) {
              generalSummary = `Sirf Engine side (Aage) me ${frontGen.length} General coaches hain`;
            } else {
              generalSummary = `Sirf Rear (Peeche) me ${generalIndices.length} General coaches hain`;
            }
          }

          let sleeperSummary = sleeperIndices.length > 0 ? `S1 se S${sleeperIndices.length} (${sleeperIndices.length} Sleeper coaches middle me)` : "Sleeper coach nahi hai";
          let acSummary = acIndices.length > 0 ? `${acIndices.length} AC coaches (${coaches.filter((c) => /^[ABHM]\d+$/.test(c) || c.includes("BE")).join(", ")})` : "AC coach nahi hai";

          let msg = `🚃 **Coach Position & Layout: ${trainName} (#${trainNumber})**\n\n`;
          msg += `🚆 **Engine (Front) ➔ Guard (Rear):**\n\`${rawPos}\`\n\n`;
          msg += `📍 **Coach Breakdown:**\n`;
          msg += `• 🟢 **General (Unreserved):** ${generalSummary}\n`;
          if (sleeperIndices.length > 0) msg += `• 🟡 **Sleeper:** ${sleeperSummary}\n`;
          if (acIndices.length > 0) msg += `• 🔵 **AC Coaches:** ${acSummary}\n`;
          if (pantryIndices.length > 0) msg += `• 🍽️ **Pantry Car:** Position #${pantryIndices.join(", ")}\n`;
          msg += `\n🔢 **Total Coaches:** ${coaches.length} dibbe`;

          return {
            success: true,
            trainNumber,
            trainName,
            rawPosition: rawPos,
            totalCoaches: coaches.length,
            generalSummary,
            sleeperSummary,
            acSummary,
            coaches,
            message: msg,
          };
        }
      }
    } catch (e) {
      console.warn("[RailRadar] Coach position error:", e);
    }

    return {
      success: true,
      trainNumber,
      message: `Boss, Train #${trainNumber} ka coach layout link: https://railradar.in/train-status/${trainNumber}`,
    };
  }

  /**
   * 6. Train Stoppage Check (Kya ye train XYZ station jayegi/rukaegi?)
   */
  public async checkTrainStoppage(trainQuery: string, targetStation: string): Promise<StoppageCheckResult> {
    const trainNumber = this.extractTrainNumber(trainQuery);
    const targetCode = this.resolveStationCode(targetStation);

    try {
      const url = `${this.baseUrl}/trains/${trainNumber}/live`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const json = await res.json();
        const d = json.data;
        const trainName = d?.trainName || d?.train?.name || `Train #${trainNumber}`;
        const route = Array.isArray(d?.route) ? d.route : [];

        const match = route.find(
          (r: any) =>
            r.stationCode === targetCode ||
            r.stationName?.toLowerCase().includes(targetStation.toLowerCase())
        );

        if (match) {
          let timeText = "";
          if (match.scheduledArrival || match.scheduledDeparture) {
            try {
              const arr = match.scheduledArrival ? new Date(match.scheduledArrival).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
              const dep = match.scheduledDeparture ? new Date(match.scheduledDeparture).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
              timeText = ` (Arrival: ${arr || "--"}, Departure: ${dep || "--"})`;
            } catch {}
          }

          const haltStatus = match.isHalt ? "✅ Scheduled Halt hai" : "⚠️ Station se pass hoti hai lekin halt nahi hai";
          let msg = `🚆 **${trainName} (#${trainNumber})**\n`;
          msg += `📍 **Station:** ${match.stationName} (${match.stationCode})\n`;
          msg += `🏢 **Stoppage:** ${haltStatus}${timeText}\n`;
          if (match.platform) msg += `🚪 **Platform:** Platform #${match.platform}\n`;

          return {
            success: true,
            trainNumber,
            trainName,
            targetStation,
            stops: !!match.isHalt,
            stationName: match.stationName,
            stationCode: match.stationCode,
            platform: match.platform,
            scheduledArrival: match.scheduledArrival,
            scheduledDeparture: match.scheduledDeparture,
            message: msg,
          };
        } else {
          return {
            success: true,
            trainNumber,
            trainName,
            targetStation,
            stops: false,
            message: `❌ Boss, Train #${trainNumber} (${trainName}) ke route me **${targetStation}** station nahi aata. Ye train is station par nahi jayegi.`,
          };
        }
      }
    } catch (e) {
      console.warn("[RailRadar] Stoppage check error:", e);
    }

    return {
      success: true,
      trainNumber,
      targetStation,
      stops: false,
      message: `Boss, Train #${trainNumber} ka route & stoppage check karein: https://railradar.in/train-status/${trainNumber}`,
    };
  }

  /**
   * 7. Nearest Station Trains / Journey Planner (e.g. from GAYA to PNBE or CNB to NDLS)
   */
  public async searchTrainsBetweenStations(fromStation: string, toStation: string): Promise<TrainsBetweenResult> {
    const fromCode = this.resolveStationCode(fromStation);
    const toCode = this.resolveStationCode(toStation);

    try {
      const url = `${this.baseUrl}/stations/${fromCode}/live`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const json = await res.json();
        const allTrains = json.data?.trains || [];
        const matching = allTrains.filter(
          (t: any) =>
            t.train?.destination === toCode ||
            t.train?.destination?.includes(toCode) ||
            t.train?.source === toCode
        );

        const targetList = matching.length > 0 ? matching : allTrains.slice(0, 6);

        const formattedTrains = targetList.slice(0, 6).map((m: any) => ({
          trainNumber: m.train?.number || m.number,
          trainName: m.train?.name || m.name,
          scheduledDeparture: m.stop?.departure || m.sta,
          expectedDeparture: m.live?.expectedDepartureTime || m.eta,
          delayMinutes: Number(m.live?.delayMinutes || m.delay || 0),
          platform: m.stop?.platform || m.platform,
        }));

        let msg = `🚆 **Available Trains from ${fromCode} ➔ ${toCode}:**\n\n`;
        formattedTrains.forEach((t: any) => {
          const delayTxt = t.delayMinutes && t.delayMinutes > 0 ? `🔴 (${t.delayMinutes}m Late)` : `🟢 (On Time)`;
          msg += `• **#${t.trainNumber}** ${t.trainName}\n  ⏱️ Dep Time: *${t.scheduledDeparture || "Soon"}* ${delayTxt}${t.platform ? ` | 🏢 Plat #${t.platform}` : ""}\n`;
        });
        msg += `\n🔗 **Live Station Board:** https://railradar.in/station-status/${fromCode}`;

        return {
          success: true,
          fromStation: fromCode,
          toStation: toCode,
          trainsCount: formattedTrains.length,
          trains: formattedTrains,
          message: msg,
        };
      }
    } catch (e) {
      console.warn("[RailRadar] Trains between stations error:", e);
    }

    return {
      success: true,
      fromStation: fromCode,
      toStation: toCode,
      trainsCount: 0,
      trains: [],
      message: `Boss, ${fromCode} se ${toCode} ki trains check karein: https://railradar.in/station-status/${fromCode}`,
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
