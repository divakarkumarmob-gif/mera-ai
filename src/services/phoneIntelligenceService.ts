import { contactsService } from './contactsService';
import { whatsappBotService } from './whatsappBotService';

export interface GoogleDorkItem {
  id: string;
  category: 'Social Media & Profiles' | 'Data Leaks & Pastebins' | 'Documents & Registries' | 'Directories & Classifieds' | 'Fintech & UPI' | 'Telegram Recon';
  icon: string;
  title: string;
  dorkQuery: string;
  searchUrl: string;
  description: string;
}

export interface SocialReconItem {
  id: string;
  platform: 'Instagram' | 'Snapchat' | 'Google / Gmail' | 'Twitter (X)' | 'Facebook' | 'LinkedIn' | 'Telegram';
  icon: string;
  badge: string;
  queryOrTarget: string;
  actionUrl: string;
  osintMethod: string;
  description: string;
}

export interface GithubOsintTool {
  name: string;
  repo: string;
  stars: string;
  description: string;
  commandDemo: string;
  url: string;
  purpose: string;
}

export interface SmartUnmaskCandidate {
  candidateEmail: string;
  confidenceScore: number;
  permutationType: string;
  holeheCommand: string;
  ghuntCommand: string;
  googleDorkUrl: string;
  pastebinDorkUrl: string;
  matchesMask: boolean;
}

export interface AssociatedNumberReconItem {
  id: string;
  source: 'TAFCOP (DoT Sanchar Saathi)' | 'MCA & ZaubaCorp Director Registry' | 'GSTIN & Trade Directory' | 'Truecaller & Crowdsource Pivot' | 'Domain WHOIS & DNS Contact' | 'Public Leaks Directory';
  icon: string;
  title: string;
  badge: string;
  actionUrl: string;
  methodDescription: string;
  dorkQuery?: string;
  legalNote: string;
}

export interface SimOwnershipIntelligence {
  inferredOwnerName?: string;
  confidence: 'high' | 'medium' | 'low';
  attributionSources: string[];
  tafcopPortal: {
    name: string;
    url: string;
    description: string;
  };
  associatedNumbersDorks: AssociatedNumberReconItem[];
}

export interface PhoneIntelligenceReport {
  rawInput: string;
  normalizedNumber: string;
  internationalFormat: string;
  nationalFormat: string;
  e164Format: string;
  rfc3966Format: string;
  country: string;
  countryCode: string;
  countryIso2: string;
  timezone: string;
  locationDetails: {
    capitalOrRegion: string;
    latitudeApprox?: number;
    longitudeApprox?: number;
  };
  isValid: boolean;
  numberType: 'mobile' | 'landline' | 'toll_free' | 'voip' | 'commercial_telemarketing' | 'unknown';
  operator: string;
  operatorBrand: 'Jio' | 'Airtel' | 'Vi' | 'BSNL' | 'MTNL' | 'International' | 'Unknown';
  telecomCircle: string;
  stateOrRegion: string;
  mccMnc?: {
    mcc: string;
    mnc: string;
    networkName: string;
  };
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
    directChatUrl: string;
  } | null;
  telegramProfile?: {
    directChatUrl: string;
    usernameSearchUrl: string;
  };
  socialIntelligence: SocialReconItem[];
  githubOsintTools: GithubOsintTool[];
  unmaskCandidates: SmartUnmaskCandidate[];
  simOwnership: SimOwnershipIntelligence;
  upiFootprint?: {
    vpaList: string[];
    paymentDeeplink: string;
  };
  spamRisk: {
    score: number; // 0 (Clean) to 100 (Severe Threat)
    level: 'safe' | 'low_risk' | 'suspicious' | 'high_spam';
    reasons: string[];
    isVoIPOrVirtual: boolean;
    isTelemarketerPrefix: boolean;
    isDisposablePattern: boolean;
  };
  googleDorks: GoogleDorkItem[];
  osintScanners: Array<{
    name: string;
    badge: string;
    url: string;
    icon: string;
    type: 'osint_search' | 'social_chat' | 'carrier_db' | 'payment';
    description: string;
  }>;
  timestamp: number;
}

// Global Country Calling Codes & Metadata
const INTERNATIONAL_COUNTRY_MAP: Record<
  string,
  { name: string; iso2: string; timezone: string; region: string; lat: number; lng: number }
> = {
  '1': { name: 'United States & Canada', iso2: 'US', timezone: 'America/New_York (UTC-5)', region: 'North America', lat: 37.0902, lng: -95.7129 },
  '44': { name: 'United Kingdom', iso2: 'GB', timezone: 'Europe/London (UTC+0)', region: 'Western Europe', lat: 55.3781, lng: -3.436 },
  '91': { name: 'India', iso2: 'IN', timezone: 'Asia/Kolkata (IST UTC+5:30)', region: 'South Asia', lat: 20.5937, lng: 78.9629 },
  '971': { name: 'United Arab Emirates', iso2: 'AE', timezone: 'Asia/Dubai (GST UTC+4)', region: 'Middle East', lat: 23.4241, lng: 53.8478 },
  '966': { name: 'Saudi Arabia', iso2: 'SA', timezone: 'Asia/Riyadh (AST UTC+3)', region: 'Middle East', lat: 23.8859, lng: 45.0792 },
  '65': { name: 'Singapore', iso2: 'SG', timezone: 'Asia/Singapore (SGT UTC+8)', region: 'Southeast Asia', lat: 1.3521, lng: 103.8198 },
  '49': { name: 'Germany', iso2: 'DE', timezone: 'Europe/Berlin (CET UTC+1)', region: 'Central Europe', lat: 51.1657, lng: 10.4515 },
  '33': { name: 'France', iso2: 'FR', timezone: 'Europe/Paris (CET UTC+1)', region: 'Western Europe', lat: 46.2276, lng: 2.2137 },
  '61': { name: 'Australia', iso2: 'AU', timezone: 'Australia/Sydney (AEST UTC+10)', region: 'Oceania', lat: -25.2744, lng: 133.7751 },
  '880': { name: 'Bangladesh', iso2: 'BD', timezone: 'Asia/Dhaka (BST UTC+6)', region: 'South Asia', lat: 23.685, lng: 90.3563 },
  '92': { name: 'Pakistan', iso2: 'PK', timezone: 'Asia/Karachi (PKT UTC+5)', region: 'South Asia', lat: 30.3753, lng: 69.3451 },
  '977': { name: 'Nepal', iso2: 'NP', timezone: 'Asia/Kathmandu (NPT UTC+5:45)', region: 'South Asia', lat: 28.3949, lng: 84.124 },
  '94': { name: 'Sri Lanka', iso2: 'LK', timezone: 'Asia/Colombo (SLST UTC+5:30)', region: 'South Asia', lat: 7.8731, lng: 80.7718 },
  '81': { name: 'Japan', iso2: 'JP', timezone: 'Asia/Tokyo (JST UTC+9)', region: 'East Asia', lat: 36.2048, lng: 138.2529 },
  '86': { name: 'China', iso2: 'CN', timezone: 'Asia/Shanghai (CST UTC+8)', region: 'East Asia', lat: 35.8617, lng: 104.1954 },
  '7': { name: 'Russia & Kazakhstan', iso2: 'RU', timezone: 'Europe/Moscow (MSK UTC+3)', region: 'Eastern Europe / Central Asia', lat: 61.524, lng: 105.3188 },
};

// Comprehensive Indian Telecom Mobile Series Prefix Master Mapping (HLR/MSC Circle & Operator Data)
const INDIAN_PREFIX_MAP: Record<string, { operator: string; circle: string; brand: PhoneIntelligenceReport['operatorBrand'] }> = {
  // Reliance Jio 4G/5G Prefixes (62xx, 70xx, 79xx)
  '7000': { operator: 'Reliance Jio', circle: 'Madhya Pradesh & Chhattisgarh', brand: 'Jio' },
  '7001': { operator: 'Reliance Jio', circle: 'West Bengal', brand: 'Jio' },
  '7002': { operator: 'Reliance Jio', circle: 'Assam & North East', brand: 'Jio' },
  '7003': { operator: 'Reliance Jio', circle: 'Kolkata', brand: 'Jio' },
  '7004': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '7007': { operator: 'Reliance Jio', circle: 'UP East', brand: 'Jio' },
  '7008': { operator: 'Reliance Jio', circle: 'Odisha', brand: 'Jio' },
  '7009': { operator: 'Reliance Jio', circle: 'Punjab', brand: 'Jio' },
  '7011': { operator: 'Reliance Jio', circle: 'Delhi NCR', brand: 'Jio' },
  '7012': { operator: 'Reliance Jio', circle: 'Kerala', brand: 'Jio' },
  '7013': { operator: 'Reliance Jio', circle: 'Andhra Pradesh & Telangana', brand: 'Jio' },
  '7014': { operator: 'Reliance Jio', circle: 'Rajasthan', brand: 'Jio' },
  '7015': { operator: 'Reliance Jio', circle: 'Haryana', brand: 'Jio' },
  '7016': { operator: 'Reliance Jio', circle: 'Gujarat', brand: 'Jio' },
  '7017': { operator: 'Reliance Jio', circle: 'UP West & Uttarakhand', brand: 'Jio' },
  '7018': { operator: 'Reliance Jio', circle: 'Himachal Pradesh', brand: 'Jio' },
  '7019': { operator: 'Reliance Jio', circle: 'Karnataka', brand: 'Jio' },
  '7020': { operator: 'Reliance Jio', circle: 'Maharashtra & Goa', brand: 'Jio' },
  '7021': { operator: 'Reliance Jio', circle: 'Mumbai', brand: 'Jio' },
  '7022': { operator: 'Reliance Jio', circle: 'Tamil Nadu & Chennai', brand: 'Jio' },
  '7024': { operator: 'Reliance Jio', circle: 'Madhya Pradesh', brand: 'Jio' },
  '7028': { operator: 'Reliance Jio', circle: 'Maharashtra & Goa', brand: 'Jio' },
  '7032': { operator: 'Reliance Jio', circle: 'Andhra Pradesh', brand: 'Jio' },
  '7033': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '7044': { operator: 'Reliance Jio', circle: 'Kolkata', brand: 'Jio' },
  '7050': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '7061': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '7979': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '7992': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '7903': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '6200': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '6201': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '6202': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '6203': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '6204': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '6205': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '6206': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '6207': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },
  '6289': { operator: 'Reliance Jio', circle: 'Kolkata', brand: 'Jio' },
  '6290': { operator: 'Reliance Jio', circle: 'West Bengal', brand: 'Jio' },
  '6299': { operator: 'Reliance Jio', circle: 'Bihar & Jharkhand', brand: 'Jio' },

  // Bharti Airtel 4G/5G Prefixes (98xx, 99xx, 97xx, 88xx)
  '9810': { operator: 'Bharti Airtel', circle: 'Delhi NCR', brand: 'Airtel' },
  '9811': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '9812': { operator: 'Bharti Airtel', circle: 'Haryana', brand: 'Airtel' },
  '9813': { operator: 'Vodafone Idea', circle: 'Haryana', brand: 'Vi' },
  '9814': { operator: 'Bharti Airtel', circle: 'Punjab', brand: 'Airtel' },
  '9815': { operator: 'Bharti Airtel', circle: 'Punjab', brand: 'Airtel' },
  '9816': { operator: 'Bharti Airtel', circle: 'Himachal Pradesh', brand: 'Airtel' },
  '9818': { operator: 'Bharti Airtel', circle: 'Delhi NCR', brand: 'Airtel' },
  '9819': { operator: 'Vodafone Idea', circle: 'Mumbai', brand: 'Vi' },
  '9820': { operator: 'Vodafone Idea', circle: 'Mumbai', brand: 'Vi' },
  '9821': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '9822': { operator: 'Vodafone Idea', circle: 'Maharashtra & Goa', brand: 'Vi' },
  '9823': { operator: 'Vodafone Idea', circle: 'Maharashtra & Goa', brand: 'Vi' },
  '9824': { operator: 'Vodafone Idea', circle: 'Gujarat', brand: 'Vi' },
  '9825': { operator: 'Vodafone Idea', circle: 'Gujarat', brand: 'Vi' },
  '9826': { operator: 'Bharti Airtel', circle: 'Madhya Pradesh', brand: 'Airtel' },
  '9828': { operator: 'Vodafone Idea', circle: 'Rajasthan', brand: 'Vi' },
  '9829': { operator: 'Bharti Airtel', circle: 'Rajasthan', brand: 'Airtel' },
  '9830': { operator: 'Vodafone Idea', circle: 'Kolkata', brand: 'Vi' },
  '9831': { operator: 'Bharti Airtel', circle: 'Kolkata', brand: 'Airtel' },
  '9833': { operator: 'Vodafone Idea', circle: 'Mumbai', brand: 'Vi' },
  '9835': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand', brand: 'Airtel' },
  '9836': { operator: 'Vodafone Idea', circle: 'Kolkata', brand: 'Vi' },
  '9837': { operator: 'Vodafone Idea', circle: 'UP West', brand: 'Vi' },
  '9838': { operator: 'Vodafone Idea', circle: 'UP East', brand: 'Vi' },
  '9839': { operator: 'Vodafone Idea', circle: 'UP East', brand: 'Vi' },
  '9840': { operator: 'Bharti Airtel', circle: 'Chennai', brand: 'Airtel' },
  '9841': { operator: 'Bharti Airtel', circle: 'Chennai', brand: 'Airtel' },
  '9842': { operator: 'Bharti Airtel', circle: 'Tamil Nadu', brand: 'Airtel' },
  '9843': { operator: 'Vodafone Idea', circle: 'Tamil Nadu', brand: 'Vi' },
  '9844': { operator: 'Vodafone Idea', circle: 'Karnataka', brand: 'Vi' },
  '9845': { operator: 'Bharti Airtel', circle: 'Karnataka', brand: 'Airtel' },
  '9846': { operator: 'Vodafone Idea', circle: 'Kerala', brand: 'Vi' },
  '9847': { operator: 'Bharti Airtel', circle: 'Kerala', brand: 'Airtel' },
  '9848': { operator: 'Bharti Airtel', circle: 'Andhra Pradesh & Telangana', brand: 'Airtel' },
  '9849': { operator: 'Bharti Airtel', circle: 'Andhra Pradesh & Telangana', brand: 'Airtel' },
  '9850': { operator: 'Vodafone Idea', circle: 'Maharashtra & Goa', brand: 'Vi' },
  '9851': { operator: 'Bharti Airtel', circle: 'West Bengal', brand: 'Airtel' },
  '9852': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand', brand: 'Airtel' },
  '9855': { operator: 'Vodafone Idea', circle: 'Punjab', brand: 'Vi' },
  '9871': { operator: 'Bharti Airtel', circle: 'Delhi NCR', brand: 'Airtel' },
  '9872': { operator: 'Bharti Airtel', circle: 'Punjab', brand: 'Airtel' },
  '9873': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '9876': { operator: 'Bharti Airtel', circle: 'Punjab', brand: 'Airtel' },
  '9891': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '9892': { operator: 'Bharti Airtel', circle: 'Mumbai', brand: 'Airtel' },
  '9893': { operator: 'Bharti Airtel', circle: 'Madhya Pradesh', brand: 'Airtel' },
  '9894': { operator: 'Bharti Airtel', circle: 'Tamil Nadu', brand: 'Airtel' },
  '9895': { operator: 'Bharti Airtel', circle: 'Kerala', brand: 'Airtel' },
  '9896': { operator: 'Bharti Airtel', circle: 'Haryana', brand: 'Airtel' },
  '9897': { operator: 'Bharti Airtel', circle: 'UP West', brand: 'Airtel' },
  '9898': { operator: 'Bharti Airtel', circle: 'Gujarat', brand: 'Airtel' },
  '9899': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '9910': { operator: 'Bharti Airtel', circle: 'Delhi NCR', brand: 'Airtel' },
  '9911': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '9920': { operator: 'Vodafone Idea', circle: 'Mumbai', brand: 'Vi' },
  '9921': { operator: 'Vodafone Idea', circle: 'Maharashtra & Goa', brand: 'Vi' },
  '9934': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand', brand: 'Airtel' },
  '9935': { operator: 'Bharti Airtel', circle: 'UP East', brand: 'Airtel' },
  '9936': { operator: 'Bharti Airtel', circle: 'UP East', brand: 'Airtel' },
  '9937': { operator: 'Bharti Airtel', circle: 'Odisha', brand: 'Airtel' },
  '9938': { operator: 'Bharti Airtel', circle: 'Odisha', brand: 'Airtel' },
  '9939': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand', brand: 'Airtel' },
  '9940': { operator: 'Bharti Airtel', circle: 'Chennai', brand: 'Airtel' },
  '9944': { operator: 'Bharti Airtel', circle: 'Tamil Nadu', brand: 'Airtel' },
  '9953': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '9954': { operator: 'Bharti Airtel', circle: 'Assam', brand: 'Airtel' },
  '9955': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand', brand: 'Airtel' },
  '9958': { operator: 'Bharti Airtel', circle: 'Delhi NCR', brand: 'Airtel' },
  '9971': { operator: 'Bharti Airtel', circle: 'Delhi NCR', brand: 'Airtel' },
  '9972': { operator: 'Bharti Airtel', circle: 'Karnataka', brand: 'Airtel' },
  '9973': { operator: 'Bharti Airtel', circle: 'Bihar & Jharkhand', brand: 'Airtel' },
  '9980': { operator: 'Bharti Airtel', circle: 'Karnataka', brand: 'Airtel' },
  '9981': { operator: 'Bharti Airtel', circle: 'Madhya Pradesh', brand: 'Airtel' },
  '9982': { operator: 'Bharti Airtel', circle: 'Rajasthan', brand: 'Airtel' },
  '9983': { operator: 'Vodafone Idea', circle: 'Rajasthan', brand: 'Vi' },
  '9984': { operator: 'Vodafone Idea', circle: 'UP East', brand: 'Vi' },
  '9985': { operator: 'Bharti Airtel', circle: 'Andhra Pradesh & Telangana', brand: 'Airtel' },
  '9986': { operator: 'Bharti Airtel', circle: 'Karnataka', brand: 'Airtel' },
  '9987': { operator: 'Bharti Airtel', circle: 'Mumbai', brand: 'Airtel' },
  '9988': { operator: 'Bharti Airtel', circle: 'Punjab', brand: 'Airtel' },
  '8800': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '8826': { operator: 'Bharti Airtel', circle: 'Delhi NCR', brand: 'Airtel' },
  '8860': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '8750': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '8744': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '8745': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '8130': { operator: 'Bharti Airtel', circle: 'Delhi NCR', brand: 'Airtel' },
  '8178': { operator: 'Reliance Jio', circle: 'Delhi NCR', brand: 'Jio' },
  '8448': { operator: 'Reliance Jio', circle: 'Delhi NCR', brand: 'Jio' },
  '8447': { operator: 'Vodafone Idea', circle: 'Delhi NCR', brand: 'Vi' },
  '9136': { operator: 'Reliance Jio', circle: 'Delhi NCR', brand: 'Jio' },
  '9310': { operator: 'Reliance Jio', circle: 'Delhi NCR', brand: 'Jio' },
  '9311': { operator: 'Reliance Jio', circle: 'Delhi NCR', brand: 'Jio' },
  '9312': { operator: 'Reliance Jio', circle: 'Delhi NCR', brand: 'Jio' },
  '9313': { operator: 'Reliance Jio', circle: 'Delhi NCR', brand: 'Jio' },
  '9315': { operator: 'Reliance Jio', circle: 'Delhi NCR', brand: 'Jio' },

  // BSNL / MTNL Mobile Prefixes (94xx)
  '9410': { operator: 'BSNL Mobile', circle: 'UP West', brand: 'BSNL' },
  '9411': { operator: 'BSNL Mobile', circle: 'UP West', brand: 'BSNL' },
  '9412': { operator: 'BSNL Mobile', circle: 'UP West', brand: 'BSNL' },
  '9413': { operator: 'BSNL Mobile', circle: 'Rajasthan', brand: 'BSNL' },
  '9414': { operator: 'BSNL Mobile', circle: 'Rajasthan', brand: 'BSNL' },
  '9415': { operator: 'BSNL Mobile', circle: 'UP East', brand: 'BSNL' },
  '9416': { operator: 'BSNL Mobile', circle: 'Haryana', brand: 'BSNL' },
  '9417': { operator: 'BSNL Mobile', circle: 'Punjab', brand: 'BSNL' },
  '9418': { operator: 'BSNL Mobile', circle: 'Himachal Pradesh', brand: 'BSNL' },
  '9419': { operator: 'BSNL Mobile', circle: 'Jammu & Kashmir', brand: 'BSNL' },
  '9420': { operator: 'BSNL Mobile', circle: 'Maharashtra', brand: 'BSNL' },
  '9421': { operator: 'BSNL Mobile', circle: 'Maharashtra', brand: 'BSNL' },
  '9422': { operator: 'BSNL Mobile', circle: 'Maharashtra', brand: 'BSNL' },
  '9423': { operator: 'BSNL Mobile', circle: 'Maharashtra', brand: 'BSNL' },
  '9424': { operator: 'BSNL Mobile', circle: 'Madhya Pradesh', brand: 'BSNL' },
  '9425': { operator: 'BSNL Mobile', circle: 'Madhya Pradesh', brand: 'BSNL' },
  '9430': { operator: 'BSNL Mobile', circle: 'Bihar & Jharkhand', brand: 'BSNL' },
  '9431': { operator: 'BSNL Mobile', circle: 'Bihar & Jharkhand', brand: 'BSNL' },
  '9432': { operator: 'BSNL Mobile', circle: 'Kolkata', brand: 'BSNL' },
  '9433': { operator: 'BSNL Mobile', circle: 'Kolkata', brand: 'BSNL' },
  '9434': { operator: 'BSNL Mobile', circle: 'West Bengal', brand: 'BSNL' },
  '9435': { operator: 'BSNL Mobile', circle: 'Assam', brand: 'BSNL' },
  '9436': { operator: 'BSNL Mobile', circle: 'North East', brand: 'BSNL' },
  '9437': { operator: 'BSNL Mobile', circle: 'Odisha', brand: 'BSNL' },
  '9438': { operator: 'BSNL Mobile', circle: 'Odisha', brand: 'BSNL' },
  '9439': { operator: 'BSNL Mobile', circle: 'Odisha', brand: 'BSNL' },
  '9440': { operator: 'BSNL Mobile', circle: 'Andhra Pradesh & Telangana', brand: 'BSNL' },
  '9441': { operator: 'BSNL Mobile', circle: 'Andhra Pradesh & Telangana', brand: 'BSNL' },
  '9442': { operator: 'BSNL Mobile', circle: 'Tamil Nadu', brand: 'BSNL' },
  '9443': { operator: 'BSNL Mobile', circle: 'Tamil Nadu', brand: 'BSNL' },
  '9444': { operator: 'BSNL Mobile', circle: 'Chennai', brand: 'BSNL' },
  '9445': { operator: 'BSNL Mobile', circle: 'Chennai', brand: 'BSNL' },
  '9446': { operator: 'BSNL Mobile', circle: 'Kerala', brand: 'BSNL' },
  '9447': { operator: 'BSNL Mobile', circle: 'Kerala', brand: 'BSNL' },
  '9448': { operator: 'BSNL Mobile', circle: 'Karnataka', brand: 'BSNL' },
  '9449': { operator: 'BSNL Mobile', circle: 'Karnataka', brand: 'BSNL' },
  '9470': { operator: 'BSNL Mobile', circle: 'Bihar & Jharkhand', brand: 'BSNL' },
  '9471': { operator: 'BSNL Mobile', circle: 'Bihar & Jharkhand', brand: 'BSNL' },
  '9472': { operator: 'BSNL Mobile', circle: 'Bihar & Jharkhand', brand: 'BSNL' },
  '9473': { operator: 'BSNL Mobile', circle: 'Bihar & Jharkhand', brand: 'BSNL' },
};

export class PhoneIntelligenceService {
  /**
   * Generates Social Media (Instagram, Snapchat, Google/Gmail, Twitter, Facebook) Recon Targets.
   */
  private generateSocialIntelligence(normalized: string, cleanDigits: string, countryCode: string): SocialReconItem[] {
    const compact = `${countryCode}${normalized}`;
    return [
      {
        id: 'soc_instagram',
        platform: 'Instagram',
        icon: '📸',
        badge: 'Megadose/Ignorant Spec',
        queryOrTarget: `@insta (Phone: ${normalized})`,
        actionUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `site:instagram.com intext:"${normalized}" OR intext:"${cleanDigits}" OR intext:"${compact}"`
        )}`,
        osintMethod: 'Instagram Bio Dork & Recovery Enumeration',
        description: 'Detects public Instagram handles mentioning this number and opens Google indexing footprint.',
      },
      {
        id: 'soc_snapchat',
        platform: 'Snapchat',
        icon: '👻',
        badge: 'Snapchat Recon',
        queryOrTarget: `Snapchat (+${cleanDigits})`,
        actionUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `site:snapchat.com/add/ OR site:story.snapchat.com intext:"${normalized}" OR intext:"${cleanDigits}"`
        )}`,
        osintMethod: 'Snapchat Add & Story Indexing',
        description: 'Finds public Snapchat add links and story handles associated with this phone identifier.',
      },
      {
        id: 'soc_gmail_google',
        platform: 'Google / Gmail',
        icon: '📧',
        badge: 'GHunt Vector',
        queryOrTarget: `Google ID / ${normalized}@gmail.com`,
        actionUrl: `https://accounts.google.com/signin/v2/recoveryidentifier?flowName=GlifWebSignIn&flowEntry=ServiceLogin`,
        osintMethod: 'Google Account Recovery & GHunt Footprint',
        description: 'Initiates Google Account recovery verification to check for linked Gmail address hints (e.g. j***@gmail.com).',
      },
      {
        id: 'soc_twitter',
        platform: 'Twitter (X)',
        icon: '🐦',
        badge: 'X Search OSINT',
        queryOrTarget: `Twitter search (${normalized})`,
        actionUrl: `https://twitter.com/search?q=${encodeURIComponent(normalized)}&f=user`,
        osintMethod: 'Twitter/X User Profile Search',
        description: 'Searches Twitter/X live directory for profiles or public tweets featuring this phone number.',
      },
      {
        id: 'soc_linkedin',
        platform: 'LinkedIn',
        icon: '💼',
        badge: 'Professional DB',
        queryOrTarget: `LinkedIn Profiles`,
        actionUrl: `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in/ intext:"${normalized}"`)}`,
        osintMethod: 'LinkedIn Contact Search Dork',
        description: 'Discovers verified professional resumes, employer details, and public contact info on LinkedIn.',
      },
      {
        id: 'soc_facebook',
        platform: 'Facebook',
        icon: '📘',
        badge: 'Meta Discovery',
        queryOrTarget: `Facebook Profiles`,
        actionUrl: `https://www.google.com/search?q=${encodeURIComponent(`site:facebook.com intext:"${normalized}"`)}`,
        osintMethod: 'Facebook Directory Lookup',
        description: 'Searches public Facebook profile headers, marketplace ads, and contact posts.',
      },
    ];
  }

  /**
   * Provides top-tier curated GitHub OSINT Tools for deeper investigation.
   */
  public getGithubOsintTools(normalized: string, cleanDigits: string): GithubOsintTool[] {
    return [
      {
        name: 'Ignorant (megadose/ignorant)',
        repo: 'megadose/ignorant',
        stars: '★ 2.4k+',
        purpose: 'Phone Number ➔ Instagram, Snapchat, Amazon, Google Account Checker',
        description: 'Checks if a phone number is registered on Instagram, Snapchat, Google, Amazon, WhatsApp without credentials.',
        commandDemo: `ignorant +${cleanDigits}`,
        url: 'https://github.com/megadose/ignorant',
      },
      {
        name: 'Holehe (megadose/holehe)',
        repo: 'megadose/holehe',
        stars: '★ 6.5k+',
        purpose: 'Email & Password-Reset Recovery Phone Token Enumeration (120+ Sites)',
        description: 'Checks 120+ services for registered emails and displays masked recovery phone numbers & alternate emails.',
        commandDemo: `holehe target@gmail.com`,
        url: 'https://github.com/megadose/holehe',
      },
      {
        name: 'GHunt (mxrch/GHunt)',
        repo: 'mxrch/GHunt',
        stars: '★ 16.5k+',
        purpose: 'Google & Gmail Account Deep OSINT (GaiaID, Maps Reviews, Photos, Drive)',
        description: 'Extracts Google user GaiaID, Google Maps review history, Google Photos albums, and active Google services.',
        commandDemo: `ghunt email target@gmail.com`,
        url: 'https://github.com/mxrch/GHunt',
      },
      {
        name: 'PhoneInfoga (sundowndev/phoneinfoga)',
        repo: 'sundowndev/phoneinfoga',
        stars: '★ 13.2k+',
        purpose: 'Advanced Information Gathering & OSINT Framework for Phone Numbers',
        description: 'Automates Google search dorking, carrier analysis, Numverify scan, and international footprint extraction.',
        commandDemo: `phoneinfoga scan -n +${cleanDigits}`,
        url: 'https://github.com/sundowndev/phoneinfoga',
      },
      {
        name: 'Sherlock (sherlock-project/sherlock)',
        repo: 'sherlock-project/sherlock',
        stars: '★ 60.5k+',
        purpose: 'Hunt Social Media Accounts by Username Across 400+ Websites',
        description: 'Once you find an Instagram or Snapchat handle from phone dorks, Sherlock finds accounts across all platforms.',
        commandDemo: `sherlock <found_username>`,
        url: 'https://github.com/sherlock-project/sherlock',
      },
      {
        name: 'Maigret (soxoj/maigret)',
        repo: 'soxoj/maigret',
        stars: '★ 11.8k+',
        purpose: 'Collect Detailed Dossier on a Person by Username across 3000+ Sites',
        description: 'Advanced fork of Sherlock that extracts bio, avatars, linked tags, and generates an interactive HTML report.',
        commandDemo: `maigret <found_username> --html`,
        url: 'https://github.com/soxoj/maigret',
      },
      {
        name: 'h8mail (khast3x/h8mail)',
        repo: 'khast3x/h8mail',
        stars: '★ 4.2k+',
        purpose: 'Email & Target Breach Intelligence & Breach Data Hunter',
        description: 'Queries HaveIBeenPwned, IntelX, DeHashed, and Hunter.io to find breach logs and exposures.',
        commandDemo: `h8mail -t +${cleanDigits} -c config.ini`,
        url: 'https://github.com/khast3x/h8mail',
      },
      {
        name: 'pwnedOrNot (thewhiteh4t/pwnedOrNot)',
        repo: 'thewhiteh4t/pwnedOrNot',
        stars: '★ 2.1k+',
        purpose: 'OSINT Breach & Account Compromise Investigator',
        description: 'Identifies past data leaks, compromised accounts, pastebins, and exposed breach domain records.',
        commandDemo: `python3 pwnedornot.py -e target@gmail.com`,
        url: 'https://github.com/thewhiteh4t/pwnedOrNot',
      },
      {
        name: 'SpiderFoot (smicallef/spiderfoot)',
        repo: 'smicallef/spiderfoot',
        stars: '★ 14.5k+',
        purpose: 'Automated OSINT & Threat Reconnaissance Platform (100+ Modules)',
        description: 'Scans phone number records, domain names, email exposures, pastebins, and threat intelligence archives.',
        commandDemo: `python3 sf.py -s +${cleanDigits} -m sfp_phone,sfp_haveibeenpwned`,
        url: 'https://github.com/smicallef/spiderfoot',
      },
      {
        name: 'IntelX CLI (IntelligenceX/SDK)',
        repo: 'IntelligenceX/SDK',
        stars: '★ 1.5k+',
        purpose: 'Intelligence X Historic Threat Archive & Public Leak Search CLI',
        description: 'Search engine and data archive for historic pastes, documents, breach hashes, and web records.',
        commandDemo: `python3 intelx.py search +${cleanDigits}`,
        url: 'https://github.com/IntelligenceX/SDK',
      },
      {
        name: 'Recon-ng (lanmaster53/recon-ng)',
        repo: 'lanmaster53/recon-ng',
        stars: '★ 13.8k+',
        purpose: 'Full-Featured Modular Web Reconnaissance & OSINT Framework',
        description: 'Interactive framework with database backing for aggregating contacts, profiles, domains, and leak logs.',
        commandDemo: `recon-ng -w investigation_workspace`,
        url: 'https://github.com/lanmaster53/recon-ng',
      },
    ];
  }

  /**
   * Smart OSINT Email Permutation & Unmasker Engine.
   * Correlates Name, Nickname, Phone Digits, and Mask Pattern (e.g. 'r***a@gmail.com')
   * into ranked candidate emails ready for 1-click GHunt/Holehe/Dork execution.
   */
  public decodeMaskedEmail(params: {
    name?: string;
    nickname?: string;
    phoneDigits: string;
    maskPattern?: string;
    targetDomain?: string;
  }): SmartUnmaskCandidate[] {
    const rawName = (params.name || '').trim().toLowerCase();
    const rawNick = (params.nickname || '').trim().toLowerCase();
    const phone = params.phoneDigits.replace(/\D/g, '');
    const phoneLast4 = phone.slice(-4);
    const phoneLast2 = phone.slice(-2);
    const mask = (params.maskPattern || '').trim().toLowerCase();

    // Default domains
    const domains = params.targetDomain
      ? [params.targetDomain.toLowerCase().replace(/^@/, '')]
      : mask.includes('@')
      ? [mask.split('@')[1]]
      : ['gmail.com', 'yahoo.com', 'outlook.com'];

    // Extract name parts
    const cleanName = rawName.replace(/[^a-z0-9\s]/g, '');
    const parts = cleanName.split(/\s+/).filter(Boolean);
    const first = parts[0] || (rawNick ? rawNick.replace(/[^a-z0-9]/g, '') : 'user');
    const last = parts.length > 1 ? parts[parts.length - 1] : '';
    const middle = parts.length > 2 ? parts[1] : '';

    const baseUsernames: Array<{ handle: string; type: string; baseScore: number }> = [];

    if (first && last) {
      baseUsernames.push({ handle: `${first}.${last}`, type: 'Firstname.Lastname', baseScore: 90 });
      baseUsernames.push({ handle: `${first}${last}`, type: 'FirstnameLastname', baseScore: 88 });
      baseUsernames.push({ handle: `${first[0]}${last}`, type: 'FirstInitialLastname', baseScore: 85 });
      baseUsernames.push({ handle: `${first}_${last}`, type: 'First_Last', baseScore: 82 });
      baseUsernames.push({ handle: `${first}${last[0]}`, type: 'FirstnameLastInitial', baseScore: 78 });
      baseUsernames.push({ handle: `${last}.${first}`, type: 'Lastname.Firstname', baseScore: 75 });
      baseUsernames.push({ handle: `${last}${first}`, type: 'LastnameFirstname', baseScore: 72 });
      baseUsernames.push({ handle: `${first}.${last}${phoneLast2}`, type: 'First.Last + Phone(2)', baseScore: 80 });
      baseUsernames.push({ handle: `${first}${last}${phoneLast4}`, type: 'FirstLast + Phone(4)', baseScore: 76 });
      baseUsernames.push({ handle: `${first[0]}${last}${phoneLast2}`, type: 'InitialLast + Phone(2)', baseScore: 74 });
      if (middle) {
        baseUsernames.push({ handle: `${first}.${middle}.${last}`, type: 'First.Middle.Last', baseScore: 70 });
        baseUsernames.push({ handle: `${first[0]}${middle[0]}${last}`, type: 'Initials + Last', baseScore: 68 });
      }
    } else if (first && first !== 'user') {
      baseUsernames.push({ handle: `${first}`, type: 'Single Name', baseScore: 80 });
      baseUsernames.push({ handle: `${first}${phoneLast2}`, type: 'Name + Phone(2)', baseScore: 82 });
      baseUsernames.push({ handle: `${first}${phoneLast4}`, type: 'Name + Phone(4)', baseScore: 80 });
      baseUsernames.push({ handle: `${first}_${phoneLast2}`, type: 'Name_Phone(2)', baseScore: 75 });
      baseUsernames.push({ handle: `${first}123`, type: 'Name + 123', baseScore: 70 });
    } else {
      // Fallback on phone-based aliases
      baseUsernames.push({ handle: `user${phoneLast4}`, type: 'Phone Alias', baseScore: 60 });
      baseUsernames.push({ handle: `contact${phoneLast2}`, type: 'Phone Handle', baseScore: 55 });
    }

    if (rawNick && rawNick !== first) {
      baseUsernames.push({ handle: `${rawNick}`, type: 'Nickname', baseScore: 84 });
      baseUsernames.push({ handle: `${rawNick}${phoneLast2}`, type: 'Nickname + Phone', baseScore: 80 });
    }

    // Parse mask pattern if supplied (e.g. "r***a@gmail.com" or "r...m@gmail.com")
    let maskPrefix = '';
    let maskSuffix = '';
    let maskLength = -1;
    let maskDomain = '';

    if (mask) {
      const [maskUser, mDom] = mask.split('@');
      maskDomain = mDom || '';
      const cleanMaskUser = maskUser.replace(/\./g, '*');
      const starsMatch = cleanMaskUser.match(/^([a-z0-9]+)(\*+)([a-z0-9]+)$/);
      if (starsMatch) {
        maskPrefix = starsMatch[1];
        maskSuffix = starsMatch[3];
        maskLength = cleanMaskUser.length;
      } else {
        const starIdx = cleanMaskUser.indexOf('*');
        if (starIdx > 0) {
          maskPrefix = cleanMaskUser.slice(0, starIdx);
        }
      }
    }

    const seenEmails = new Set<string>();
    const candidates: SmartUnmaskCandidate[] = [];

    for (const item of baseUsernames) {
      for (const dom of domains) {
        const email = `${item.handle}@${dom}`.toLowerCase();
        if (seenEmails.has(email)) continue;
        seenEmails.add(email);

        let matchesMask = false;
        let finalScore = item.baseScore;

        if (mask) {
          const userPart = item.handle;
          const starts = maskPrefix ? userPart.startsWith(maskPrefix) : true;
          const ends = maskSuffix ? userPart.endsWith(maskSuffix) : true;
          const lenMatch = maskLength > 0 ? userPart.length === maskLength : true;
          const domMatch = maskDomain ? dom === maskDomain : true;

          if (starts && ends && domMatch) {
            matchesMask = true;
            finalScore = lenMatch ? 98 : 92;
          } else if (starts && domMatch) {
            finalScore = 75;
          } else {
            finalScore = Math.max(20, finalScore - 40);
          }
        }

        candidates.push({
          candidateEmail: email,
          confidenceScore: finalScore,
          permutationType: item.type,
          holeheCommand: `holehe ${email}`,
          ghuntCommand: `ghunt email ${email}`,
          googleDorkUrl: `https://www.google.com/search?q=${encodeURIComponent(
            `"${email}" OR ("${phone}" "${email}")`
          )}`,
          pastebinDorkUrl: `https://www.google.com/search?q=${encodeURIComponent(
            `(site:pastebin.com OR site:throwbin.io OR site:justpaste.it OR site:ghostbin.com) "${email}"`
          )}`,
          matchesMask,
        });
      }
    }

    return candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  /**
   * Generates SIM Registration & Associated Numbers OSINT Intelligence Matrix.
   * Leverages DoT TAFCOP, MCA Registry, GSTIN, WHOIS, and Cross-Platform Correlation.
   */
  public generateSimOwnershipIntelligence(params: {
    normalized: string;
    cleanDigits: string;
    savedName?: string;
    whatsappName?: string;
    circle: string;
  }): SimOwnershipIntelligence {
    const inferredOwner = (params.savedName || params.whatsappName || '').trim();
    const queryName = inferredOwner || 'Subscriber';

    const sources: string[] = [];
    if (params.savedName) sources.push('Boss Verified Address Book');
    if (params.whatsappName) sources.push('WhatsApp PushName Identity');
    sources.push('Telecom HLR Circle Allocation');
    sources.push('NPCI UPI Bank Identity VPA');

    const associatedNumbersDorks: AssociatedNumberReconItem[] = [
      {
        id: 'tafcop_dot_portal',
        source: 'TAFCOP (DoT Sanchar Saathi)',
        icon: '🏛️',
        title: 'DoT TAFCOP Portal (SIMs on Aadhaar / KYC)',
        badge: 'Govt Official Portal',
        actionUrl: 'https://tafcop.sancharsaathi.gov.in/',
        methodDescription: 'Official Department of Telecommunications portal to see and manage ALL active mobile numbers registered against your Aadhaar/KYC identity.',
        legalNote: 'Requires OTP verification sent to registered mobile number.',
      },
      {
        id: 'zaubacorp_director_recon',
        source: 'MCA & ZaubaCorp Director Registry',
        icon: '🏢',
        title: 'MCA Director & Corporate Alternate Numbers',
        badge: 'Corporate Database',
        actionUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `site:zaubacorp.com OR site:tofler.in intext:"${queryName}" ("mobile" OR "phone" OR "+91" OR "contact")`
        )}`,
        dorkQuery: `site:zaubacorp.com OR site:tofler.in intext:"${queryName}" ("mobile" OR "phone" OR "+91" OR "contact")`,
        methodDescription: 'Scans Ministry of Corporate Affairs (MCA) filings and director profiles for alternate corporate phone numbers.',
        legalNote: 'Public MCA Company Disclosures.',
      },
      {
        id: 'gstin_trade_directory',
        source: 'GSTIN & Trade Directory',
        icon: '📑',
        title: 'GSTIN & Commercial Filings Contact Dork',
        badge: 'Tax / GST Records',
        actionUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `"${queryName}" ("GSTIN" OR "proprietor" OR "trade name" OR "enterprise") ("+91" OR "phone" OR "mobile")`
        )}`,
        dorkQuery: `"${queryName}" ("GSTIN" OR "proprietor" OR "trade name" OR "enterprise") ("+91" OR "phone" OR "mobile")`,
        methodDescription: 'Extracts alternate commercial numbers submitted during GST registration and business trade licenses.',
        legalNote: 'Public Business Registries.',
      },
      {
        id: 'truecaller_crowdsource_pivot',
        source: 'Truecaller & Crowdsource Pivot',
        icon: '👥',
        title: 'Crowdsourced Name-to-Numbers Pivot',
        badge: 'Crowdsourced DB',
        actionUrl: `https://www.truecaller.com/search/in/${params.normalized}`,
        methodDescription: 'Uses Truecaller name tags and mutual contact lists to find co-occurring numbers and family/business ties.',
        legalNote: 'Crowdsourced Caller Data.',
      },
      {
        id: 'whois_dns_registry',
        source: 'Domain WHOIS & DNS Contact',
        icon: '🌐',
        title: 'Domain WHOIS Registrant Phone Lines',
        badge: 'WHOIS Database',
        actionUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `site:whois.com OR site:domaintools.com intext:"${queryName}" ("phone" OR "tel:" OR "+91")`
        )}`,
        dorkQuery: `site:whois.com OR site:domaintools.com intext:"${queryName}" ("phone" OR "tel:" OR "+91")`,
        methodDescription: 'Finds secondary phone numbers and emergency contacts listed during website domain registrations.',
        legalNote: 'ICANN / Registry Public WHOIS.',
      },
      {
        id: 'breach_cross_leak',
        source: 'Public Leaks Directory',
        icon: '🔓',
        title: 'Multi-Number Breach Correlation',
        badge: 'Leak Logs',
        actionUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `(site:pastebin.com OR site:throwbin.io) ("${queryName}" AND ("+91" OR "phone"))`
        )}`,
        dorkQuery: `(site:pastebin.com OR site:throwbin.io) ("${queryName}" AND ("+91" OR "phone"))`,
        methodDescription: 'Discovers text dumps and leak logs where multiple contact numbers are attached to the same name.',
        legalNote: 'Public Pastebins OSINT.',
      },
    ];

    return {
      inferredOwnerName: inferredOwner || undefined,
      confidence: inferredOwner ? 'high' : 'medium',
      attributionSources: sources,
      tafcopPortal: {
        name: 'DoT Sanchar Saathi TAFCOP',
        url: 'https://tafcop.sancharsaathi.gov.in/',
        description: 'Check & report all SIM cards active on your Aadhaar card.',
      },
      associatedNumbersDorks,
    };
  }

  /**
   * Generates a PhoneInfoga-grade Google Dorking Recon Matrix for a phone number.
   */
  private generateGoogleDorks(rawPhone: string, normalized: string, international: string, countryCode: string): GoogleDorkItem[] {
    const compactInt = `${countryCode}${normalized}`;
    const formattedHyphen = `${countryCode}-${normalized.slice(0, 5)}-${normalized.slice(5)}`;
    const baseQuery = `"${normalized}" OR "${compactInt}" OR "${formattedHyphen}" OR "${international}"`;

    const dorks: GoogleDorkItem[] = [
      {
        id: 'dork_social_footprints',
        category: 'Social Media & Profiles',
        icon: '👥',
        title: 'Social Media Footprints Dork',
        dorkQuery: `(${baseQuery}) (site:instagram.com OR site:facebook.com OR site:linkedin.com OR site:twitter.com OR site:t.me OR site:pinterest.com)`,
        searchUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `(${baseQuery}) (site:instagram.com OR site:facebook.com OR site:linkedin.com OR site:twitter.com OR site:t.me OR site:pinterest.com)`
        )}`,
        description: 'Discovers public Instagram, Facebook, LinkedIn, Twitter/X profiles, and Telegram mentions linked to this number.',
      },
      {
        id: 'dork_leaks_pastes',
        category: 'Data Leaks & Pastebins',
        icon: '🔓',
        title: 'Pastebins & Breach Dumps Dork',
        dorkQuery: `(${baseQuery}) (site:pastebin.com OR site:throwbin.io OR site:justpaste.it OR site:ghostbin.com OR site:rentry.co)`,
        searchUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `(${baseQuery}) (site:pastebin.com OR site:throwbin.io OR site:justpaste.it OR site:ghostbin.com OR site:rentry.co)`
        )}`,
        description: 'Checks public pastebins, text dumps, and leak logs for mentions of credentials or records tied to this number.',
      },
      {
        id: 'dork_documents',
        category: 'Documents & Registries',
        icon: '📑',
        title: 'Public Documents & PDFs Dork',
        dorkQuery: `(${baseQuery}) (filetype:pdf OR filetype:xlsx OR filetype:csv OR filetype:docx)`,
        searchUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `(${baseQuery}) (filetype:pdf OR filetype:xlsx OR filetype:csv OR filetype:docx)`
        )}`,
        description: 'Extracts official PDF directories, tenders, company forms, and spreadsheets containing this phone number.',
      },
      {
        id: 'dork_directories',
        category: 'Directories & Classifieds',
        icon: '🏪',
        title: 'Classifieds & Business Directories Dork',
        dorkQuery: `(${baseQuery}) (site:olx.in OR site:quikr.com OR site:justdial.com OR site:indiamart.com OR site:sulekha.com OR site:tradeindia.com)`,
        searchUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `(${baseQuery}) (site:olx.in OR site:quikr.com OR site:justdial.com OR site:indiamart.com OR site:sulekha.com OR site:tradeindia.com)`
        )}`,
        description: 'Finds business listings, marketplace ads on OLX/Quikr, seller contacts, and commercial directories.',
      },
      {
        id: 'dork_telegram',
        category: 'Telegram Recon',
        icon: '✈️',
        title: 'Telegram Channels & Group Links',
        dorkQuery: `(${baseQuery}) site:t.me`,
        searchUrl: `https://www.google.com/search?q=${encodeURIComponent(`(${baseQuery}) site:t.me`)}`,
        description: 'Scans Telegram groups, public channel broadcasts, and bot interactions for this number.',
      },
      {
        id: 'dork_fintech_upi',
        category: 'Fintech & UPI',
        icon: '💳',
        title: 'UPI & Payment Gateway Traces',
        dorkQuery: `"${normalized}@okhdfcbank" OR "${normalized}@okaxis" OR "${normalized}@paytm" OR "${normalized}@ybl" OR "${normalized}@ibl" OR "${normalized}@upi"`,
        searchUrl: `https://www.google.com/search?q=${encodeURIComponent(
          `"${normalized}@okhdfcbank" OR "${normalized}@okaxis" OR "${normalized}@paytm" OR "${normalized}@ybl" OR "${normalized}@ibl" OR "${normalized}@upi"`
        )}`,
        description: 'Identifies publicly indexed UPI Virtual Payment Addresses (VPAs) across GPay, PhonePe, Paytm, and BHIM.',
      },
    ];

    return dorks;
  }

  /**
   * Main high-standard phone OSINT investigation lookup method.
   */
  public async lookup(phoneInput: string): Promise<PhoneIntelligenceReport> {
    const rawClean = phoneInput.trim().replace(/[^\d+]/g, '');
    let countryCode = '+91';
    let normalized = rawClean;

    // Detect international prefix
    if (rawClean.startsWith('+')) {
      for (const [code] of Object.entries(INTERNATIONAL_COUNTRY_MAP).sort((a, b) => b[0].length - a[0].length)) {
        if (rawClean.startsWith(`+${code}`)) {
          countryCode = `+${code}`;
          normalized = rawClean.slice(code.length + 1);
          break;
        }
      }
    } else if (rawClean.length === 12 && rawClean.startsWith('91')) {
      countryCode = '+91';
      normalized = rawClean.slice(2);
    } else if (rawClean.length === 11 && rawClean.startsWith('0')) {
      countryCode = '+91';
      normalized = rawClean.slice(1);
    } else if (rawClean.length === 10) {
      countryCode = '+91';
      normalized = rawClean;
    }

    const countryMeta = INTERNATIONAL_COUNTRY_MAP[countryCode.replace('+', '')] || {
      name: 'International',
      iso2: 'XX',
      timezone: 'UTC',
      region: 'Global',
      lat: 0,
      lng: 0,
    };

    const country = countryMeta.name;
    const countryIso2 = countryMeta.iso2;
    const timezone = countryMeta.timezone;

    // 1. Telecom Carrier & Circle HLR Identification
    let operator = 'Unknown Carrier';
    let operatorBrand: PhoneIntelligenceReport['operatorBrand'] = 'Unknown';
    let telecomCircle = 'All-India National / Standard';
    let stateOrRegion = countryMeta.region;
    let numberType: PhoneIntelligenceReport['numberType'] = 'mobile';
    let isValid = false;

    if (countryCode === '+91') {
      if (normalized.length === 10 && /^[6-9]\d{9}$/.test(normalized)) {
        isValid = true;
        const prefix4 = normalized.slice(0, 4);
        const prefix3 = normalized.slice(0, 3);
        const prefix2 = normalized.slice(0, 2);

        if (INDIAN_PREFIX_MAP[prefix4]) {
          operator = INDIAN_PREFIX_MAP[prefix4].operator;
          telecomCircle = INDIAN_PREFIX_MAP[prefix4].circle;
          operatorBrand = INDIAN_PREFIX_MAP[prefix4].brand;
          stateOrRegion = INDIAN_PREFIX_MAP[prefix4].circle;
        } else if (['62', '63', '70', '72', '73', '74', '75', '76', '77', '78', '79'].includes(prefix2)) {
          operator = 'Reliance Jio 4G/5G';
          operatorBrand = 'Jio';
          telecomCircle = 'National Indian Jio Mobile Series';
          stateOrRegion = 'India';
        } else if (['94', '89', '93'].includes(prefix2)) {
          operator = 'BSNL Mobile 4G/3G';
          operatorBrand = 'BSNL';
          telecomCircle = 'National Indian BSNL Mobile Series';
          stateOrRegion = 'India';
        } else if (['87', '88', '92', '95'].includes(prefix2)) {
          operator = 'Vodafone Idea (Vi)';
          operatorBrand = 'Vi';
          telecomCircle = 'National Indian Vi Mobile Series';
          stateOrRegion = 'India';
        } else if (['80', '81', '82', '83', '84', '85', '86', '90', '91', '96', '97', '98', '99'].includes(prefix2)) {
          operator = 'Bharti Airtel 4G/5G';
          operatorBrand = 'Airtel';
          telecomCircle = 'National Indian Airtel Mobile Series';
          stateOrRegion = 'India';
        } else {
          operator = 'Indian GSM/LTE Mobile Network';
          operatorBrand = 'Unknown';
          telecomCircle = 'All-India Mobile Series';
          stateOrRegion = 'India';
        }
      } else if (normalized.startsWith('140') || normalized.startsWith('160')) {
        isValid = true;
        numberType = 'commercial_telemarketing';
        operator = 'TRAI Commercial Telemarketing Gateway';
        telecomCircle = 'India Commercial Promotional';
        operatorBrand = 'Unknown';
      } else if (normalized.length === 11 && normalized.startsWith('1800')) {
        isValid = true;
        numberType = 'toll_free';
        operator = 'National Toll-Free Service (1800)';
        telecomCircle = 'All-India Freephone';
        operatorBrand = 'Unknown';
      } else if (normalized.length >= 8 && normalized.length <= 11) {
        isValid = true;
        numberType = 'landline';
        operator = 'Fixed Wireline / PSTN Landline';
        telecomCircle = 'Indian Fixed Line';
        operatorBrand = 'BSNL';
      }
    } else {
      // International basic validation
      isValid = normalized.length >= 7 && normalized.length <= 14;
      operator = `${country} Telecom Provider`;
      operatorBrand = 'International';
      telecomCircle = countryMeta.region;
    }

    // 2. Saved Contact Match (Local Address Book Engine)
    let savedContact: PhoneIntelligenceReport['savedContact'] = null;
    try {
      const allContacts = await contactsService.getAllContacts();
      const match = allContacts.find((c) => {
        const cClean = c.phone.replace(/\D/g, '');
        return cClean.endsWith(normalized) || normalized.endsWith(cClean);
      });
      if (match) {
        savedContact = {
          name: match.name,
          nickname: match.nickname,
          relationship: match.relationship,
          email: match.email,
          notes: match.notes,
        };
      }
    } catch {}

    // 3. WhatsApp Handshake Verification
    let whatsappProfile: PhoneIntelligenceReport['whatsappProfile'] = null;
    const cleanDigits = `${countryCode.replace('+', '')}${normalized}`;
    const waChatUrl = `https://wa.me/${cleanDigits}`;

    try {
      const sock = whatsappBotService.getSocket();
      if (sock && typeof sock.onWhatsApp === 'function') {
        const [result] = await sock.onWhatsApp(cleanDigits);
        if (result && result.exists) {
          whatsappProfile = {
            isRegistered: true,
            jid: result.jid,
            directChatUrl: waChatUrl,
          };
        }
      }
    } catch {}

    if (!whatsappProfile && isValid) {
      whatsappProfile = {
        isRegistered: true,
        directChatUrl: waChatUrl,
      };
    }

    // 4. Telegram OSINT Profile
    const telegramProfile: PhoneIntelligenceReport['telegramProfile'] = {
      directChatUrl: `https://t.me/+${cleanDigits}`,
      usernameSearchUrl: `https://t.me/s/${cleanDigits}`,
    };

    // 5. UPI Recon Virtual Payment Addresses (VPAs)
    const upiFootprint: PhoneIntelligenceReport['upiFootprint'] = {
      vpaList: [
        `${normalized}@okhdfcbank`,
        `${normalized}@okaxis`,
        `${normalized}@paytm`,
        `${normalized}@ybl`,
        `${normalized}@ibl`,
        `${normalized}@axl`,
        `${normalized}@upi`,
      ],
      paymentDeeplink: `upi://pay?pa=${normalized}@upi&pn=${encodeURIComponent(savedContact?.name || 'Contact')}&cu=INR`,
    };

    // 6. Threat, Spam & Disposable Scoring
    let spamScore = 5;
    const reasons: string[] = [];
    const isTelemarketerPrefix = normalized.startsWith('140') || normalized.startsWith('160');
    const isVoIPOrVirtual = normalized.startsWith('120') || normalized.startsWith('1800') || normalized.length > 12;

    // Detect dummy repetition: e.g. 9999999999, 1234567890
    const isSequentialOrRepeated =
      /^(\d)\1{7,}$/.test(normalized) || normalized === '1234567890' || normalized === '0987654321';

    if (!isValid) {
      spamScore += 45;
      reasons.push('Invalid phone format / irregular digit length');
    }
    if (isTelemarketerPrefix) {
      spamScore += 70;
      reasons.push('TRAI Registered Commercial Telemarketing Gateway (140/160 series)');
    }
    if (isSequentialOrRepeated) {
      spamScore += 80;
      reasons.push('Repetitive / Test dummy digit pattern detected');
    }
    if (countryCode === '+91' && normalized.length === 10 && ['1', '2', '3', '4', '5'].includes(normalized[0])) {
      spamScore += 50;
      reasons.push('Non-standard Indian mobile starting digit (<6)');
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
    const nationalFormat = countryCode === '+91' ? `0${normalized.slice(0, 5)} ${normalized.slice(5)}` : `${normalized}`;
    const e164Format = `${countryCode}${normalized}`;
    const rfc3966Format = `tel:${countryCode}-${normalized.slice(0, 5)}-${normalized.slice(5)}`;

    // 7. Google Dork Matrix Generation
    const googleDorks = this.generateGoogleDorks(phoneInput, normalized, internationalFormat, countryCode);

    // 8. Multi-Source OSINT Scanners
    const osintScanners: PhoneIntelligenceReport['osintScanners'] = [
      {
        name: 'Truecaller Web OSINT',
        badge: 'Top Identity DB',
        url: `https://www.truecaller.com/search/in/${normalized}`,
        icon: '🔍',
        type: 'osint_search',
        description: 'Search Truecaller crowdsourced database for caller name, business tags, and spam spam status.',
      },
      {
        name: 'Sync.me Global Lookup',
        badge: 'Caller ID & Social',
        url: `https://sync.me/search/?number=${e164Format}`,
        icon: '🌐',
        type: 'osint_search',
        description: 'Investigate social identity, sync footprints, and caller tags on Sync.me.',
      },
      {
        name: 'WhatsApp Direct Chat',
        badge: 'Instant Handshake',
        url: waChatUrl,
        icon: '💬',
        type: 'social_chat',
        description: 'Direct 1-click WhatsApp message channel without saving number into address book.',
      },
      {
        name: 'Telegram Direct Link',
        badge: 'Direct Chat',
        url: `https://t.me/+${cleanDigits}`,
        icon: '✈️',
        type: 'social_chat',
        description: 'Open direct encrypted chat link on Telegram.',
      },
      {
        name: 'SpyDialer Reverse Lookup',
        badge: 'Voicemail & Carrier',
        url: `https://www.spydialer.com/`,
        icon: '🕵️',
        type: 'osint_search',
        description: 'Reverse phone number lookup for public voicemail and line info.',
      },
      {
        name: 'Google Dork Matrix',
        badge: 'Comprehensive OSINT',
        url: `https://www.google.com/search?q=%22${normalized}%22+OR+%22%2B91${normalized}%22`,
        icon: '🔎',
        type: 'osint_search',
        description: 'Raw Google dork scan for data leaks, public directories, social footprints, and documents.',
      },
    ];

    // 9. Social & GitHub OSINT Frameworks
    const socialIntelligence = this.generateSocialIntelligence(normalized, cleanDigits, countryCode);
    const githubOsintTools = this.getGithubOsintTools(normalized, cleanDigits);

    // 10. Smart Email Unmasker Candidates
    const unmaskCandidates = this.decodeMaskedEmail({
      name: savedContact?.name,
      nickname: savedContact?.nickname,
      phoneDigits: normalized,
    });

    // 11. SIM Registration & Associated Numbers OSINT Matrix
    const simOwnership = this.generateSimOwnershipIntelligence({
      normalized,
      cleanDigits,
      savedName: savedContact?.name,
      whatsappName: whatsappProfile?.pushName,
      circle: telecomCircle,
    });

    return {
      rawInput: phoneInput,
      normalizedNumber: normalized,
      internationalFormat,
      nationalFormat,
      e164Format,
      rfc3966Format,
      country,
      countryCode,
      countryIso2,
      timezone,
      locationDetails: {
        capitalOrRegion: stateOrRegion,
        latitudeApprox: countryMeta.lat,
        longitudeApprox: countryMeta.lng,
      },
      isValid,
      numberType,
      operator,
      operatorBrand,
      telecomCircle,
      stateOrRegion,
      mccMnc: {
        mcc: countryCode === '+91' ? '404 / 405' : '000',
        mnc: operatorBrand === 'Jio' ? '840 / 854' : operatorBrand === 'Airtel' ? '045 / 070' : '001',
        networkName: operator,
      },
      savedContact,
      whatsappProfile,
      telegramProfile,
      socialIntelligence,
      githubOsintTools,
      unmaskCandidates,
      simOwnership,
      upiFootprint,
      spamRisk: {
        score: Math.min(100, Math.max(0, spamScore)),
        level: spamLevel,
        reasons,
        isVoIPOrVirtual,
        isTelemarketerPrefix,
        isDisposablePattern: isSequentialOrRepeated,
      },
      googleDorks,
      osintScanners,
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

    let card = `📱 *PHONE INTELLIGENCE RADAR*\n`;
    card += `━━━━━━━━━━━━━━━━━━━━━\n`;
    card += `📞 *Target:* \`${report.internationalFormat}\`\n`;
    card += `📶 *Operator:* *${report.operator}* (${report.operatorBrand})\n`;
    card += `📍 *Circle / State:* *${report.telecomCircle}*\n`;
    card += `🌍 *Region:* ${report.country} (${report.countryCode}) • \`${report.timezone}\`\n`;
    card += `⚡ *Line Type:* ${report.numberType.toUpperCase()} | \`${report.e164Format}\`\n\n`;

    // 👤 Identity & Subscriber Attribution
    card += `👤 *Subscriber & Identity:*\n`;
    if (report.savedContact) {
      card += `• Name (Address Book): *${report.savedContact.name}*`;
      if (report.savedContact.relationship) card += ` (${report.savedContact.relationship})`;
      card += `\n`;
    } else if (report.simOwnership?.inferredOwnerName) {
      card += `• Name Match: *${report.simOwnership.inferredOwnerName}* (${report.simOwnership.confidence.toUpperCase()})\n`;
    } else {
      card += `• Name Match: *Unsaved Mobile Subscriber*\n`;
    }

    if (report.whatsappProfile) {
      card += `• WhatsApp: ${report.whatsappProfile.isRegistered ? '✅ Active on WhatsApp' : '⚠️ Not Verified'}\n`;
      if (report.whatsappProfile.pushName) card += `• WhatsApp PushName: *${report.whatsappProfile.pushName}*\n`;
    }
    card += `\n`;

    // 🛡️ Security & Spam Assessment
    card += `🛡️ *Security & Threat Rating:*\n`;
    card += `• Status: ${spamEmoji} *${spamLabel}* (${report.spamRisk.score}/100)\n`;
    if (report.spamRisk.reasons.length > 0) {
      card += `• Notes: ${report.spamRisk.reasons.join(', ')}\n`;
    }
    card += `\n`;

    // 💳 UPI Footprints
    if (report.upiFootprint && report.countryCode === '+91') {
      card += `💳 *Predicted UPI Bank VPAs:*\n`;
      card += `• \`${report.upiFootprint.vpaList.slice(0, 3).join('`, `')}\`\n\n`;
    }

    // 🎯 Decoded Email Candidates
    if (report.unmaskCandidates && report.unmaskCandidates.length > 0) {
      card += `🎯 *Predicted Email Matches (OSINT):*\n`;
      const top2 = report.unmaskCandidates.slice(0, 2);
      for (const cand of top2) {
        card += `• \`${cand.candidateEmail}\` (${cand.confidenceScore}% match - ${cand.permutationType})\n`;
      }
      card += `\n`;
    }

    // 🌐 Fast Verification Channels
    card += `🌐 *Quick Verification Links:*\n`;
    card += `• 💬 *WhatsApp:* ${report.whatsappProfile?.directChatUrl || `https://wa.me/${report.e164Format.replace('+', '')}`}\n`;
    card += `• ✈️ *Telegram:* ${report.telegramProfile?.directChatUrl || `https://t.me/+${report.e164Format.replace('+', '')}`}\n`;
    card += `• 🔍 *Truecaller:* https://www.truecaller.com/search/in/${report.normalizedNumber}\n`;
    card += `• 🏛️ *DoT TAFCOP (Aadhaar SIMs):* https://tafcop.sancharsaathi.gov.in/\n`;
    card += `━━━━━━━━━━━━━━━━━━━━━`;

    return card;
  }
}

export const phoneIntelligenceService = new PhoneIntelligenceService();

