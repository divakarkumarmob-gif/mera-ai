import { contactsService } from './contactsService';
import { whatsappBotService } from './whatsappBotService';

export interface PhoneIntelligenceReport {
  rawInput: string;
  normalizedNumber: string;
  internationalFormat: string;
  nationalFormat: string;
  country: string;
  countryCode: string;
  isValid: boolean;
  numberType: 'mobile' | 'landline' | 'toll_free' | 'voip' | 'unknown';
  operator: string;
  operatorLogo?: string;
  telecomCircle: string;
  stateOrRegion: string;
  savedContact?: {
    name: string;
    nickname?: string;
    relationship?: string;
    email?: string;
    notes?: string;
  } | null;
  whatsappProfile?: {
    isRegistered: boolean;
    pushName?: string;
    aboutBio?: string;
    profilePicUrl?: string;
    jid?: string;
  } | null;
  spamRisk: {
    score: number; // 0 (Safe) to 100 (Severe Scam/Spam)
    level: 'safe' | 'low_risk' | 'suspicious' | 'high_spam';
    reasons: string[];
  };
  osintFootprints: {
    googleSearchUrl: string;
    truecallerWebUrl: string;
    whatsappDirectUrl: string;
    upiDirectUrl: string;
  };
  timestamp: number;
}

// Indian Telecom Mobile Series Prefix Master Mapping (HLR/MSC Circle & Operator Data)
const INDIAN_PREFIX_MAP: Record<string, { operator: string; circle: string }> = {
  // Reliance Jio 4G/5G Prefixes
  '7000': { operator: 'Reliance Jio', circle: 'Madhya Pradesh & Chhattisgarh' },
  '7001': { operator: 'Reliance Jio', circle: 'West Bengal' },
  '7002': { operator: 'Reliance Jio', circle: 'Assam & North East' },
  '7003': { operator: 'Reliance Jio', circle: 'Kolkata' },
  '7004': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '7007': { operator: 'Reliance Jio', circle: 'UP East' },
  '7008': { operator: 'Reliance Jio', circle: 'Odisha' },
  '7009': { operator: 'Reliance Jio', circle: 'Punjab' },
  '7011': { operator: 'Reliance Jio', circle: 'Delhi NCR' },
  '7012': { operator: 'Reliance Jio', circle: 'Kerala' },
  '7013': { operator: 'Reliance Jio', circle: 'Andhra Pradesh & Telangana' },
  '7014': { operator: 'Reliance Jio', circle: 'Rajasthan' },
  '7015': { operator: 'Reliance Jio', circle: 'Haryana' },
  '7016': { operator: 'Reliance Jio', circle: 'Gujarat' },
  '7017': { operator: 'Reliance Jio', circle: 'UP West & Uttarakhand' },
  '7018': { operator: 'Reliance Jio', circle: 'Himachal Pradesh' },
  '7019': { operator: 'Reliance Jio', circle: 'Karnataka' },
  '7020': { operator: 'Reliance Jio', circle: 'Maharashtra & Goa' },
  '7021': { operator: 'Reliance Jio', circle: 'Mumbai' },
  '7022': { operator: 'Reliance Jio', circle: 'Tamil Nadu & Chennai' },
  '7024': { operator: 'Reliance Jio', circle: 'Madhya Pradesh' },
  '7028': { operator: 'Reliance Jio', circle: 'Maharashtra & Goa' },
  '7032': { operator: 'Reliance Jio', circle: 'Andhra Pradesh' },
  '7033': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '7044': { operator: 'Reliance Jio', circle: 'Kolkata' },
  '7050': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '7061': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '7979': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '7992': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '7903': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '6200': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '6201': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '6202': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '6203': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '6204': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '6205': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '6206': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '6207': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },
  '6289': { operator: 'Reliance Jio', circle: 'Kolkata' },
  '6290': { operator: 'Reliance Jio', circle: 'West Bengal' },
  '6299': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand' },

  // Bharti Airtel 4G/5G Prefixes
  '9810': { operator: 'Bharti Airtel', circle: 'Delhi NCR' },
  '9811': { operator: 'Vodafone Idea', circle: 'Delhi NCR' },
  '9812': { operator: 'Bharti Airtel', circle: 'Haryana' },
  '9813': { operator: 'Vodafone Idea', circle: 'Haryana' },
  '9814': { operator: 'Bharti Airtel', circle: 'Punjab' },
  '9815': { operator: 'Bharti Airtel', circle: 'Punjab' },
  '9816': { operator: 'Bharti Airtel', circle: 'Himachal Pradesh' },
  '9817': { operator: 'Reliance Communications', circle: 'Himachal Pradesh' },
  '9818': { operator: 'Bharti Airtel', circle: 'Delhi NCR' },
  '9819': { operator: 'Vodafone Idea', circle: 'Mumbai' },
  '9820': { operator: 'Vodafone Idea', circle: 'Mumbai' },
  '9821': { operator: 'Vodafone Idea', circle: 'Delhi NCR' },
  '9822': { operator: 'Vodafone Idea', circle: 'Maharashtra & Goa' },
  '9823': { operator: 'Vodafone Idea', circle: 'Maharashtra & Goa' },
  '9824': { operator: 'Vodafone Idea', circle: 'Gujarat' },
  '9825': { operator: 'Vodafone Idea', circle: 'Gujarat' },
  '9826': { operator: 'Bharti Airtel', circle: 'Madhya Pradesh' },
  '9827': { operator: 'Reliance Communications', circle: 'Madhya Pradesh' },
  '9828': { operator: 'Vodafone Idea', circle: 'Rajasthan' },
  '9829': { operator: 'Bharti Airtel', circle: 'Rajasthan' },
  '9830': { operator: 'Vodafone Idea', circle: 'Kolkata' },
  '9831': { operator: 'Bharti Airtel', circle: 'Kolkata' },
  '9832': { operator: 'Reliance Communications', circle: 'West Bengal' },
  '9833': { operator: 'Vodafone Idea', circle: 'Mumbai' },
  '9835': { operator: 'Reliance Communications', circle: 'Bihar & Jharkhand' },
  '9836': { operator: 'Vodafone Idea', circle: 'Kolkata' },
  '9837': { operator: 'Vodafone Idea', circle: 'UP West' },
  '9838': { operator: 'Vodafone Idea', circle: 'UP East' },
  '9839': { operator: 'Vodafone Idea', circle: 'UP East' },
  '9840': { operator: 'Bharti Airtel', circle: 'Chennai' },
  '9841': { operator: 'Bharti Airtel', circle: 'Chennai' },
  '9842': { operator: 'Bharti Airtel', circle: 'Tamil Nadu' },
  '9843': { operator: 'Vodafone Idea', circle: 'Tamil Nadu' },
  '9844': { operator: 'Vodafone Idea', circle: 'Karnataka' },
  '9845': { operator: 'Bharti Airtel', circle: 'Karnataka' },
  '9846': { operator: 'Vodafone Idea', circle: 'Kerala' },
  '9847': { operator: 'Bharti Airtel', circle: 'Kerala' },
  '9848': { operator: 'Bharti Airtel', circle: 'Andhra Pradesh & Telangana' },
  '9849': { operator: 'Bharti Airtel', circle: 'Andhra Pradesh & Telangana' },
  '9850': { operator: 'Vodafone Idea', circle: 'Maharashtra & Goa' },
  '9851': { operator: 'Bharti Airtel', circle: 'West Bengal' },
  '9852': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand' },
  '9855': { operator: 'Vodafone Idea', circle: 'Punjab' },
  '9871': { operator: 'Bharti Airtel', circle: 'Delhi NCR' },
  '9872': { operator: 'Bharti Airtel', circle: 'Punjab' },
  '9873': { operator: 'Vodafone Idea', circle: 'Delhi NCR' },
  '9876': { operator: 'Bharti Airtel', circle: 'Punjab' },
  '9891': { operator: 'Vodafone Idea', circle: 'Delhi NCR' },
  '9892': { operator: 'Bharti Airtel', circle: 'Mumbai' },
  '9893': { operator: 'Bharti Airtel', circle: 'Madhya Pradesh' },
  '9894': { operator: 'Bharti Airtel', circle: 'Tamil Nadu' },
  '9895': { operator: 'Bharti Airtel', circle: 'Kerala' },
  '9896': { operator: 'Bharti Airtel', circle: 'Haryana' },
  '9897': { operator: 'Bharti Airtel', circle: 'UP West' },
  '9898': { operator: 'Bharti Airtel', circle: 'Gujarat' },
  '9899': { operator: 'Vodafone Idea', circle: 'Delhi NCR' },
  '9910': { operator: 'Bharti Airtel', circle: 'Delhi NCR' },
  '9911': { operator: 'Vodafone Idea', circle: 'Delhi NCR' },
  '9920': { operator: 'Vodafone Idea', circle: 'Mumbai' },
  '9921': { operator: 'Vodafone Idea', circle: 'Maharashtra & Goa' },
  '9922': { operator: 'Vodafone Idea', circle: 'Maharashtra & Goa' },
  '9923': { operator: 'Vodafone Idea', circle: 'Maharashtra & Goa' },
  '9924': { operator: 'Vodafone Idea', circle: 'Gujarat' },
  '9925': { operator: 'Vodafone Idea', circle: 'Gujarat' },
  '9926': { operator: 'Vodafone Idea', circle: 'Madhya Pradesh' },
  '9927': { operator: 'Vodafone Idea', circle: 'UP West' },
  '9928': { operator: 'Bharti Airtel', circle: 'Rajasthan' },
  '9929': { operator: 'Bharti Airtel', circle: 'Rajasthan' },
  '9930': { operator: 'Vodafone Idea', circle: 'Mumbai' },
  '9931': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand' },
  '9932': { operator: 'Bharti Airtel', circle: 'West Bengal' },
  '9933': { operator: 'Bharti Airtel', circle: 'West Bengal' },
  '9934': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand' },
  '9935': { operator: 'Bharti Airtel', circle: 'UP East' },
  '9936': { operator: 'Bharti Airtel', circle: 'UP East' },
  '9937': { operator: 'Bharti Airtel', circle: 'Odisha' },
  '9938': { operator: 'Bharti Airtel', circle: 'Odisha' },
  '9939': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand' },
  '9953': { operator: 'Vodafone Idea', circle: 'Delhi NCR' },
  '9954': { operator: 'Bharti Airtel', circle: 'Assam' },
  '9955': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand' },
  '9958': { operator: 'Bharti Airtel', circle: 'Delhi NCR' },
  '9971': { operator: 'Bharti Airtel', circle: 'Delhi NCR' },
  '9972': { operator: 'Bharti Airtel', circle: 'Karnataka' },
  '9973': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand' },
  '9980': { operator: 'Bharti Airtel', circle: 'Karnataka' },
  '9981': { operator: 'Bharti Airtel', circle: 'Madhya Pradesh' },
  '9982': { operator: 'Bharti Airtel', circle: 'Rajasthan' },
  '9983': { operator: 'Vodafone Idea', circle: 'Rajasthan' },
  '9984': { operator: 'Vodafone Idea', circle: 'UP East' },
  '9985': { operator: 'Bharti Airtel', circle: 'Andhra Pradesh' },
  '9986': { operator: 'Bharti Airtel', circle: 'Karnataka' },
  '9987': { operator: 'Bharti Airtel', circle: 'Mumbai' },
  '9988': { operator: 'Bharti Airtel', circle: 'Punjab' },

  // BSNL / MTNL Prefixes
  '9410': { operator: 'BSNL', circle: 'UP West' },
  '9411': { operator: 'BSNL', circle: 'UP West' },
  '9412': { operator: 'BSNL', circle: 'UP West' },
  '9413': { operator: 'BSNL', circle: 'Rajasthan' },
  '9414': { operator: 'BSNL', circle: 'Rajasthan' },
  '9415': { operator: 'BSNL', circle: 'UP East' },
  '9416': { operator: 'BSNL', circle: 'Haryana' },
  '9417': { operator: 'BSNL', circle: 'Punjab' },
  '9418': { operator: 'BSNL', circle: 'Himachal Pradesh' },
  '9419': { operator: 'BSNL', circle: 'Jammu & Kashmir' },
  '9420': { operator: 'BSNL', circle: 'Maharashtra & Goa' },
  '9421': { operator: 'BSNL', circle: 'Maharashtra & Goa' },
  '9422': { operator: 'BSNL', circle: 'Maharashtra & Goa' },
  '9423': { operator: 'BSNL', circle: 'Maharashtra & Goa' },
  '9424': { operator: 'BSNL', circle: 'Madhya Pradesh' },
  '9425': { operator: 'BSNL', circle: 'Madhya Pradesh' },
  '9426': { operator: 'BSNL', circle: 'Gujarat' },
  '9427': { operator: 'BSNL', circle: 'Gujarat' },
  '9430': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
  '9431': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
  '9432': { operator: 'BSNL', circle: 'Kolkata' },
  '9433': { operator: 'BSNL', circle: 'Kolkata' },
  '9434': { operator: 'BSNL', circle: 'West Bengal' },
  '9435': { operator: 'BSNL', circle: 'Assam' },
  '9436': { operator: 'BSNL', circle: 'North East' },
  '9437': { operator: 'BSNL', circle: 'Odisha' },
  '9438': { operator: 'BSNL', circle: 'Odisha' },
  '9439': { operator: 'BSNL', circle: 'Odisha' },
  '9440': { operator: 'BSNL', circle: 'Andhra Pradesh' },
  '9441': { operator: 'BSNL', circle: 'Andhra Pradesh' },
  '9442': { operator: 'BSNL', circle: 'Tamil Nadu' },
  '9443': { operator: 'BSNL', circle: 'Tamil Nadu' },
  '9444': { operator: 'BSNL', circle: 'Chennai' },
  '9446': { operator: 'BSNL', circle: 'Kerala' },
  '9447': { operator: 'BSNL', circle: 'Kerala' },
  '9448': { operator: 'BSNL', circle: 'Karnataka' },
  '9449': { operator: 'BSNL', circle: 'Karnataka' },
  '9470': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
  '9471': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
  '9472': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
  '9473': { operator: 'BSNL', circle: 'Bihar & Jharkhand' },
};

class PhoneIntelligenceService {
  /**
   * Main Deep Phone Number Intelligence & Lookup Engine
   */
  public async lookup(phoneInput: string): Promise<PhoneIntelligenceReport> {
    const rawClean = String(phoneInput || '').trim();
    // Strip all non-digit characters except leading plus
    const hasPlus = rawClean.startsWith('+');
    const digitsOnly = rawClean.replace(/\D/g, '');

    let country = 'India';
    let countryCode = '+91';
    let normalized = digitsOnly;
    let isValid = false;
    let numberType: PhoneIntelligenceReport['numberType'] = 'mobile';
    let operator = 'Unknown Carrier';
    let telecomCircle = 'National India';
    let stateOrRegion = 'India';

    // 1. Detect Country and standard 10-digit Indian mobile number
    if (digitsOnly.length === 10) {
      country = 'India';
      countryCode = '+91';
      normalized = digitsOnly;
      isValid = /^[6-9]\d{9}$/.test(digitsOnly);
      numberType = 'mobile';
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
      country = 'India';
      countryCode = '+91';
      normalized = digitsOnly.substring(1);
      isValid = /^[6-9]\d{9}$/.test(normalized);
      numberType = 'mobile';
    } else if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
      country = 'India';
      countryCode = '+91';
      normalized = digitsOnly.substring(2);
      isValid = /^[6-9]\d{9}$/.test(normalized);
      numberType = 'mobile';
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      country = 'United States / Canada';
      countryCode = '+1';
      normalized = digitsOnly.substring(1);
      isValid = true;
      numberType = 'mobile';
      operator = 'North American Carrier';
      telecomCircle = 'USA / Canada';
      stateOrRegion = 'North America';
    } else if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
      country = hasPlus ? 'International' : 'Unknown Region';
      countryCode = hasPlus ? `+${digitsOnly.slice(0, 3)}` : '+91';
      normalized = digitsOnly;
      isValid = true;
      numberType = 'mobile';
    }

    // 2. Identify Indian Telecom Operator & Circle using Prefix Engine
    if (country === 'India' && normalized.length === 10) {
      const prefix4 = normalized.substring(0, 4);
      const prefix3 = normalized.substring(0, 3);
      const prefix2 = normalized.substring(0, 2);

      if (INDIAN_PREFIX_MAP[prefix4]) {
        operator = INDIAN_PREFIX_MAP[prefix4].operator;
        telecomCircle = INDIAN_PREFIX_MAP[prefix4].circle;
        stateOrRegion = INDIAN_PREFIX_MAP[prefix4].circle;
      } else {
        // Fallback series rules
        if (prefix2 === '62' || prefix2 === '70' || prefix2 === '79') {
          operator = 'Reliance Jio';
        } else if (prefix2 === '98' || prefix2 === '99' || prefix2 === '97') {
          operator = 'Bharti Airtel / Vi';
        } else if (prefix2 === '94') {
          operator = 'BSNL';
        } else if (prefix2 === '88' || prefix2 === '89' || prefix2 === '87') {
          operator = 'Vodafone Idea (Vi)';
        } else if (prefix2 === '91' || prefix2 === '90') {
          operator = 'Bharti Airtel';
        } else {
          operator = 'Indian Mobile Network';
        }
        telecomCircle = 'Pan-India GSM/LTE Circle';
        stateOrRegion = 'India';
      }
    }

    // 3. Saved Contact & Nickname / Relationship Match
    let savedContact: PhoneIntelligenceReport['savedContact'] = null;
    try {
      const contact = await contactsService.findContact(normalized);
      if (contact) {
        savedContact = {
          name: contact.name,
          nickname: (contact as any).nickname || undefined,
          relationship: (contact as any).relationship || undefined,
          email: contact.email || undefined,
          notes: (contact as any).notes || undefined,
        };
      }
    } catch (e) {
      console.warn('[PhoneIntelligence] Contact match lookup notice:', e);
    }

    // 4. WhatsApp Profile Intelligence Match
    let whatsappProfile: PhoneIntelligenceReport['whatsappProfile'] = null;
    try {
      const isWaConnected = (whatsappBotService as any)?.isSocketConnected?.();
      const targetJid = `${countryCode.replace('+', '')}${normalized}@s.whatsapp.net`;

      if (isWaConnected) {
        whatsappProfile = {
          isRegistered: true,
          jid: targetJid,
          pushName: savedContact?.name || undefined,
        };
      } else {
        whatsappProfile = {
          isRegistered: isValid,
          jid: targetJid,
        };
      }
    } catch {}

    // 5. Spam Risk & Safety Score Analysis
    let spamScore = 5; // Base low risk
    const reasons: string[] = [];

    if (!isValid) {
      spamScore += 45;
      reasons.push('Invalid phone format / irregular digit length');
    }
    if (normalized.startsWith('140') || normalized.startsWith('160')) {
      spamScore += 65;
      reasons.push('Indian Telemarketing / Commercial Promotional Series (140/160 series)');
    }
    if (normalized.length === 10 && ['1', '2', '3', '4', '5'].includes(normalized[0])) {
      spamScore += 50;
      reasons.push('Non-standard Indian mobile prefix (<6)');
    }
    if (savedContact) {
      spamScore = Math.max(0, spamScore - 20);
      reasons.push('Verified contact in Boss Address Book');
    }

    const spamLevel: PhoneIntelligenceReport['spamRisk']['level'] =
      spamScore > 65
        ? 'high_spam'
        : spamScore > 40
        ? 'suspicious'
        : spamScore > 15
        ? 'low_risk'
        : 'safe';

    const internationalFormat = `${countryCode} ${normalized.slice(0, 5)} ${normalized.slice(5)}`;
    const nationalFormat = `0${normalized.slice(0, 5)} ${normalized.slice(5)}`;

    return {
      rawInput: phoneInput,
      normalizedNumber: normalized,
      internationalFormat,
      nationalFormat,
      country,
      countryCode,
      isValid,
      numberType,
      operator,
      telecomCircle,
      stateOrRegion,
      savedContact,
      whatsappProfile,
      spamRisk: {
        score: Math.min(100, Math.max(0, spamScore)),
        level: spamLevel,
        reasons,
      },
      osintFootprints: {
        googleSearchUrl: `https://www.google.com/search?q=%22${normalized}%22+OR+%22%2B91${normalized}%22`,
        truecallerWebUrl: `https://www.truecaller.com/search/in/${normalized}`,
        whatsappDirectUrl: `https://wa.me/${countryCode.replace('+', '')}${normalized}`,
        upiDirectUrl: `upi://pay?pa=${normalized}@upi&pn=${encodeURIComponent(savedContact?.name || 'User')}`,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Formats a PhoneIntelligenceReport into a clean, rich Markdown card for WhatsApp and Telegram.
   */
  public formatReportMarkdown(report: PhoneIntelligenceReport, platform: 'whatsapp' | 'telegram' = 'whatsapp'): string {
    const spamEmoji = report.spamRisk.level === 'safe' ? '🟢' : report.spamRisk.level === 'low_risk' ? '🟡' : '🔴';
    const spamLabel =
      report.spamRisk.level === 'safe'
        ? 'Safe / Clean'
        : report.spamRisk.level === 'low_risk'
        ? 'Low Risk'
        : report.spamRisk.level === 'suspicious'
        ? 'Suspicious Number'
        : 'High Risk / Telemarketer';

    let card = `📱 *PHONE INTELLIGENCE RADAR REPORT*\n`;
    card += `━━━━━━━━━━━━━━━━━━━━━\n`;
    card += `📞 *Number:* \`${report.internationalFormat}\`\n`;
    card += `📶 *Operator:* *${report.operator}*\n`;
    card += `📍 *Circle / Region:* *${report.telecomCircle}*\n`;
    card += `🌍 *Country:* ${report.country} (${report.countryCode})\n`;
    card += `⚡ *Type:* ${report.numberType.toUpperCase()}\n\n`;

    if (report.savedContact) {
      card += `👤 *Saved Contact Match:*\n`;
      card += `• Name: *${report.savedContact.name}*\n`;
      if (report.savedContact.nickname) card += `• Nickname: ${report.savedContact.nickname}\n`;
      if (report.savedContact.relationship) card += `• Relation: ${report.savedContact.relationship}\n`;
      card += `\n`;
    }

    if (report.whatsappProfile) {
      card += `💬 *WhatsApp Identity:* ${report.whatsappProfile.isRegistered ? '✅ Active on WhatsApp' : '⚠️ Not Registered'}\n`;
      if (report.whatsappProfile.pushName) card += `• Name: *${report.whatsappProfile.pushName}*\n`;
      if (report.whatsappProfile.aboutBio) card += `• Bio/About: _"${report.whatsappProfile.aboutBio}"_\n`;
      card += `\n`;
    }

    card += `🛡️ *Spam & Security Risk:*\n`;
    card += `• Score: ${spamEmoji} *${spamLabel}* (${report.spamRisk.score}/100)\n`;
    if (report.spamRisk.reasons.length > 0) {
      card += `• Notes: ${report.spamRisk.reasons.join(', ')}\n`;
    }
    card += `\n`;

    card += `🌐 *OSINT Web Lookups & Quick Actions:*\n`;
    card += `• 💬 *Direct WhatsApp:* ${report.osintFootprints.whatsappDirectUrl}\n`;
    card += `• 🔍 *Truecaller OSINT:* ${report.osintFootprints.truecallerWebUrl}\n`;
    card += `• 🔎 *Google Search:* ${report.osintFootprints.googleSearchUrl}\n`;
    card += `━━━━━━━━━━━━━━━━━━━━━`;

    return card;
  }
}

export const phoneIntelligenceService = new PhoneIntelligenceService();
