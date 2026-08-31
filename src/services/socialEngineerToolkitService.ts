/**
 * FRIDAY AI — Social Engineer Toolkit (SET) Service (Pure JS)
 * Social engineering simulation, phishing detection & awareness training
 * Inspired by: https://github.com/trustedsec/social-engineer-toolkit
 *
 * Features:
 *  - Phishing email template generator (spear/mass)
 *  - Pretexting script generator
 *  - Smishing (SMS phishing) template generator
 *  - Phishing URL analyzer & detector
 *  - Credential harvester page templates
 *  - Vishing (voice phishing) scripts
 *  - Social engineering awareness training
 *  - Campaign builder
 *  - OSINT-based target profiling for simulations
 *
 * ⚠️ FOR AUTHORIZED PENETRATION TESTING & AWARENESS TRAINING ONLY!
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------
export interface PhishingEmailTemplate {
  id: string;
  name: string;
  category: "corporate" | "banking" | "tech" | "hr" | "urgent" | "delivery" | "healthcare";
  subject: string;
  senderName: string;
  senderEmail: string;
  htmlBody: string;
  textBody: string;
  redFlags: string[];          // Training: these are the red flags to spot
  difficulty: "easy" | "medium" | "hard";
}

export interface PretextingScript {
  id: string;
  scenario: string;
  role: string;                // attacker's fake role
  target: string;              // who they're calling
  objective: string;
  openingLine: string;
  keyPoints: string[];
  responses: Record<string, string>;  // if target says X, say Y
  exitStrategy: string;
  redFlags: string[];
}

export interface SmishingTemplate {
  id: string;
  category: string;
  sender: string;
  message: string;
  callToAction: string;
  redFlags: string[];
}

export interface VishingScript {
  id: string;
  scenario: string;
  script: string[];            // line-by-line script
  psychologicalTriggers: string[];
  redFlags: string[];
}

export interface PhishingUrlAnalysis {
  url: string;
  isPhishing: boolean;
  riskScore: number;           // 0-100
  indicators: string[];
  legitimateSite?: string;     // what it's pretending to be
  techniques: string[];        // typosquatting, homograph, etc.
  recommendation: string;
}

export interface SetCampaign {
  id: string;
  name: string;
  type: "phishing" | "smishing" | "vishing" | "physical";
  targetDescription: string;
  templates: string[];
  timeline: string[];
  metrics: string[];
  awareness: string[];
}

export interface HarvesterPageTemplate {
  id: string;
  mimics: string;              // what site it mimics
  htmlCode: string;
  redFlags: string[];
  detectionTips: string[];
}

// ---------------------------------------------------------------------------
// Phishing Email Templates
// ---------------------------------------------------------------------------
const PHISHING_TEMPLATES: PhishingEmailTemplate[] = [
  {
    id: "corp-password-reset",
    name: "Corporate Password Reset",
    category: "corporate",
    subject: "⚠️ Urgent: Your account password will expire in 24 hours",
    senderName: "IT Security Team",
    senderEmail: "it-security@company-support.net",
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #ddd;padding:20px">
  <div style="background:#0078d4;padding:15px;text-align:center">
    <h2 style="color:white;margin:0">🔒 IT Security Alert</h2>
  </div>
  <div style="padding:20px">
    <p>Dear <strong>[TARGET_NAME]</strong>,</p>
    <p>Our system has detected that your corporate password is scheduled to <strong style="color:red">expire in 24 hours</strong>.</p>
    <p>To avoid being locked out of your account, please reset your password immediately by clicking the button below:</p>
    <div style="text-align:center;margin:30px 0">
      <a href="[PHISHING_LINK]" style="background:#0078d4;color:white;padding:15px 30px;text-decoration:none;border-radius:5px;font-size:16px">
        Reset My Password Now
      </a>
    </div>
    <p style="color:#666;font-size:13px">This link will expire in 24 hours. If you did not request this, please contact IT helpdesk immediately.</p>
    <p>Best regards,<br><strong>IT Security Team</strong></p>
  </div>
  <div style="background:#f5f5f5;padding:10px;text-align:center;font-size:11px;color:#999">
    © 2025 Corporate IT Security | This is an automated message, please do not reply
  </div>
</div>`,
    textBody: `Dear [TARGET_NAME],\n\nYour corporate password will expire in 24 hours. Reset immediately: [PHISHING_LINK]\n\nIT Security Team`,
    redFlags: [
      "Sender email is 'company-support.net' not the real company domain",
      "Creates urgency with '24 hours' deadline",
      "Generic greeting with placeholder [TARGET_NAME]",
      "Hover over button — URL doesn't match company domain",
      "Legitimate IT teams don't usually send urgent password reset emails",
      "Requests immediate action to create panic",
    ],
    difficulty: "medium",
  },
  {
    id: "bank-account-suspended",
    name: "Bank Account Suspension Alert",
    category: "banking",
    subject: "ACTION REQUIRED: Your account has been temporarily suspended",
    senderName: "Security Department",
    senderEmail: "security@hdfc-bank-alerts.com",
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#d32f2f;padding:20px;text-align:center">
    <h2 style="color:white">🏦 Account Security Alert</h2>
  </div>
  <div style="border:2px solid #d32f2f;padding:20px">
    <p><strong>Dear Valued Customer,</strong></p>
    <p>We have detected <strong>suspicious activity</strong> on your account. As a security measure, your account has been <strong style="color:red">temporarily suspended</strong>.</p>
    <p>To restore access, verify your identity within <strong>12 hours</strong> or your account will be permanently closed.</p>
    <div style="text-align:center;margin:20px 0">
      <a href="[PHISHING_LINK]" style="background:#d32f2f;color:white;padding:15px 40px;text-decoration:none;border-radius:3px;font-size:18px">
        VERIFY NOW
      </a>
    </div>
    <p>You will need: Account number, ATM PIN, OTP sent to registered mobile</p>
  </div>
</div>`,
    textBody: `Dear Customer, Your account is suspended. Verify now: [PHISHING_LINK]. Requires: Account number, ATM PIN, OTP.`,
    redFlags: [
      "Real bank domain is hdfcbank.com — 'hdfc-bank-alerts.com' is fake",
      "Banks NEVER ask for ATM PIN via email",
      "Extremely urgent timeline (12 hours) creates panic",
      "No personalization — says 'Valued Customer' not your name",
      "Threatening language: 'permanently closed'",
      "Requests sensitive info (ATM PIN, OTP)",
    ],
    difficulty: "easy",
  },
  {
    id: "hr-salary-revision",
    name: "HR Salary Revision Document",
    category: "hr",
    subject: "Confidential: Your Salary Revision Letter - FY2025-26",
    senderName: "HR Department",
    senderEmail: "hr.payroll@company-hrms.in",
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="border-bottom:3px solid #2e7d32;padding-bottom:15px;margin-bottom:20px">
    <h2 style="color:#2e7d32">Human Resources Department</h2>
    <p style="color:#666">Confidential Communication</p>
  </div>
  <p>Dear <strong>[TARGET_NAME]</strong>,</p>
  <p>Please find attached your <strong>salary revision letter for FY2025-26</strong>. Your revised CTC reflects a <strong style="color:#2e7d32">23% increase</strong> effective from September 1, 2025.</p>
  <p>Please login to the HR portal to acknowledge receipt and complete the necessary documentation:</p>
  <div style="text-align:center;margin:25px 0">
    <a href="[PHISHING_LINK]" style="background:#2e7d32;color:white;padding:12px 30px;text-decoration:none;border-radius:5px">
      View Salary Letter & Acknowledge
    </a>
  </div>
  <p style="font-size:12px;color:#999">Please do not share this communication. For queries, contact hr@company.com</p>
</div>`,
    textBody: `Dear [TARGET_NAME], Your salary revision letter is ready. 23% hike. View: [PHISHING_LINK]`,
    redFlags: [
      "HR email domain is 'company-hrms.in' not the official company domain",
      "Tempts with unrealistic 23% salary hike",
      "HR salary letters are usually shared via official HRMS portals, not email links",
      "Marking as 'Confidential' to prevent you sharing with IT",
      "Link leads to external site, not company portal",
      "Sense of excitement overrides security caution",
    ],
    difficulty: "hard",
  },
  {
    id: "delivery-failed",
    name: "Package Delivery Failure",
    category: "delivery",
    subject: "Your package could not be delivered - Reschedule now",
    senderName: "FedEx Delivery",
    senderEmail: "no-reply@fedex-delivery-notification.com",
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#4d148c;padding:15px;text-align:center">
    <h2 style="color:white">📦 FedEx Delivery Notification</h2>
  </div>
  <div style="padding:20px;border:1px solid #ddd">
    <p>We attempted to deliver your package <strong>#FX${Math.floor(Math.random() * 9000000 + 1000000)}</strong> today but were unable to reach you.</p>
    <p>To reschedule your delivery, a small redelivery fee of <strong>₹39</strong> must be paid:</p>
    <div style="text-align:center;margin:20px">
      <a href="[PHISHING_LINK]" style="background:#ff6200;color:white;padding:12px 30px;text-decoration:none;border-radius:3px">
        Pay ₹39 & Reschedule Delivery
      </a>
    </div>
    <p style="font-size:11px;color:#999">Tracking: FX${Math.floor(Math.random() * 9000000 + 1000000)} | Expires: 48 hours</p>
  </div>
</div>`,
    textBody: `FedEx delivery failed. Pay ₹39 to reschedule: [PHISHING_LINK]`,
    redFlags: [
      "fedex.com is official — 'fedex-delivery-notification.com' is fake",
      "FedEx never charges redelivery fees via email payment links",
      "Small amount (₹39) reduces victim suspicion",
      "Once you enter card details, bigger fraud follows",
      "No tracking number provided before clicking link",
      "Urgency: '48 hours' deadline",
    ],
    difficulty: "medium",
  },
  {
    id: "microsoft-mfa-bypass",
    name: "Microsoft MFA Verification",
    category: "tech",
    subject: "Microsoft: Additional verification required for your account",
    senderName: "Microsoft Account Team",
    senderEmail: "account-security@microsoft-verification.net",
    htmlBody: `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="padding:20px;text-align:center;border-bottom:1px solid #ddd">
    <span style="color:#00a4ef;font-size:28px;font-weight:bold">Microsoft</span>
  </div>
  <div style="padding:30px">
    <h3>Verify your Microsoft account</h3>
    <p>We noticed a sign-in attempt from a new location. For your security, please verify your identity.</p>
    <p><strong>Location:</strong> [LOCATION]<br>
    <strong>Device:</strong> Unknown Windows PC<br>
    <strong>Time:</strong> Just now</p>
    <div style="text-align:center;margin:25px">
      <a href="[PHISHING_LINK]" style="background:#0078d4;color:white;padding:12px 35px;text-decoration:none;border-radius:3px">
        Verify My Identity
      </a>
    </div>
    <p style="font-size:12px;color:#666">If you recognize this activity, you can ignore this email.</p>
  </div>
</div>`,
    textBody: `Microsoft: New sign-in detected. Verify: [PHISHING_LINK]`,
    redFlags: [
      "microsoft.com is official — 'microsoft-verification.net' is FAKE",
      "Microsoft sends MFA prompts via Authenticator app, not email links",
      "Hover the link — it goes to a non-Microsoft domain",
      "Location field is empty placeholder or generic",
      "Creates fear of unauthorized access",
    ],
    difficulty: "hard",
  },
];

// ---------------------------------------------------------------------------
// Pretexting Scripts
// ---------------------------------------------------------------------------
const PRETEXTING_SCRIPTS: PretextingScript[] = [
  {
    id: "it-helpdesk",
    scenario: "IT Helpdesk Credential Reset",
    role: "IT Support Engineer",
    target: "Employee",
    objective: "Obtain employee credentials or get them to run malicious software",
    openingLine: "Hello, this is [NAME] calling from IT Helpdesk. We're doing a routine security audit and noticed your account may have been compromised. Do you have a few minutes?",
    keyPoints: [
      "Establish credibility by mentioning internal tools (e.g., 'Our monitoring system flagged your account')",
      "Create urgency: 'We need to resolve this before end of day'",
      "Ask for password under guise of 'verification'",
      "Or ask them to install 'remote support tool' (malware)",
      "Use name of real IT person if obtained via OSINT",
    ],
    responses: {
      "How do I know you're from IT?": "You can verify by calling our helpdesk at [give fake number]. But this is time-sensitive, your account is being actively accessed.",
      "I should check with my manager": "Of course, but our system shows the breach is ongoing. Your manager has already been notified. We need to act now.",
      "Can you email me instead?": "We've temporarily locked your email as a precaution. That's why I'm calling directly.",
    },
    exitStrategy: "Thank you for your cooperation. You'll receive a confirmation email once the security update is complete. Have a great day!",
    redFlags: [
      "Legitimate IT never asks for your password over phone",
      "Real IT helpdesk verifies YOUR identity, not the other way",
      "Pressure to act immediately is a major red flag",
      "Unknown caller ID or suspicious number",
      "Asks to install remote software from unofficial link",
    ],
  },
  {
    id: "vendor-invoice",
    scenario: "Fake Vendor Invoice Fraud",
    role: "Accounts Payable / Vendor",
    target: "Finance Department Employee",
    objective: "Redirect payment to attacker's bank account",
    openingLine: "Hi, this is [NAME] from [VENDOR_NAME]. I'm calling about invoice #[NUMBER] that was sent last month. We've recently updated our banking details and wanted to ensure the payment goes to the right account.",
    keyPoints: [
      "Research vendor names from company website, LinkedIn, or public records",
      "Create plausible invoice number",
      "Casually mention banking change — make it seem routine",
      "Request 'just a small test payment first'",
    ],
    responses: {
      "I need to verify this with procurement": "Of course! Just a heads up that our old account will be closed by Friday, so please update ASAP after verification.",
      "Can you send this in writing?": "Absolutely, what email should I send it to? [Use answer to further social engineer]",
      "We'll need approval from CFO": "Understood. Our CEO was in touch with yours last week. This was discussed at executive level.",
    },
    exitStrategy: "Thanks so much for your help. Please update the records before Friday and we'll ensure the invoice is processed smoothly.",
    redFlags: [
      "Always verify bank detail changes via a callback to the vendor's KNOWN number",
      "Never update payment details based on a cold call alone",
      "Cross-check invoice number with procurement team",
      "Urgency around 'account closing' deadline",
      "Request to keep it confidential",
    ],
  },
];

// ---------------------------------------------------------------------------
// SMS Phishing (Smishing) Templates
// ---------------------------------------------------------------------------
const SMISHING_TEMPLATES: SmishingTemplate[] = [
  {
    id: "sbi-kyc",
    category: "Banking",
    sender: "SBI-ALERT",
    message: "Dear Customer, Your SBI account KYC is pending. Account will be suspended in 24hrs. Update KYC now: [LINK] -SBI",
    callToAction: "Click the link to update KYC",
    redFlags: [
      "SBI uses official SMS headers, real format is different",
      "Official SBI KYC is done at branch or via official app",
      "Shortened or suspicious URL in SMS",
      "24-hour urgency creates panic",
      "Never click banking links from SMS — go directly to official app",
    ],
  },
  {
    id: "courier-otp",
    category: "Delivery",
    sender: "AMAZON",
    message: "Your Amazon package is on hold. Verify your address to release delivery. Click: [LINK] - Amazon Logistics",
    callToAction: "Click to verify address",
    redFlags: [
      "Amazon uses official links like amazon.in/track — not external URLs",
      "Sender ID can be spoofed to look like 'AMAZON'",
      "Real delivery issues are handled via Amazon app/website",
      "Link leads to credential harvesting page",
    ],
  },
  {
    id: "ola-reward",
    category: "Reward",
    sender: "OLA-WIN",
    message: "Congratulations! You won ₹5000 Ola Money. Claim in 2hrs: [LINK] . Enter OTP to verify.",
    callToAction: "Click and enter OTP to claim prize",
    redFlags: [
      "Ola doesn't randomly give cash prizes via SMS",
      "OTP sharing = account takeover",
      "Too good to be true = definitely phishing",
      "Urgency '2hrs' prevents you from thinking clearly",
    ],
  },
  {
    id: "income-tax",
    category: "Government",
    sender: "INCOME-TAX",
    message: "IT Dept: Tax refund of Rs.8,420 approved for PAN [XXXX]. Submit bank details at: [LINK] to receive refund within 24hrs.",
    callToAction: "Submit bank details for refund",
    redFlags: [
      "Tax refunds are processed automatically to registered bank account — no link needed",
      "IT department uses official portal incometax.gov.in only",
      "Never submit bank details via SMS link",
      "Partial PAN shown to make it seem legitimate",
    ],
  },
];

// ---------------------------------------------------------------------------
// Vishing (Voice Phishing) Scripts
// ---------------------------------------------------------------------------
const VISHING_SCRIPTS: VishingScript[] = [
  {
    id: "bank-fraud-alert",
    scenario: "Fake Bank Fraud Call",
    script: [
      "Hello, am I speaking with [TARGET_NAME]?",
      "Good afternoon, I'm calling from [BANK_NAME] Fraud Prevention Department. My employee ID is FP-[RANDOM].",
      "We've detected an unauthorized transaction of ₹45,000 on your account from a location in [DISTANT_CITY].",
      "Did you authorize this transaction?",
      "[Wait for response]",
      "As per protocol, we need to freeze this immediately. I'll need to verify your identity with your account number and the OTP you'll receive.",
      "Please share the OTP that just came to your registered mobile number.",
    ],
    psychologicalTriggers: [
      "Fear: Large unauthorized transaction",
      "Authority: Bank fraud department with fake employee ID",
      "Urgency: Need to act now to prevent loss",
      "Social proof: Mentions 'protocol' to seem official",
    ],
    redFlags: [
      "Banks NEVER ask for OTP over phone — OTP is secret",
      "Legitimate fraud calls ask you to confirm, not share details",
      "Hang up and call your bank's official number on back of card",
      "Caller ID can be spoofed to show bank's number",
    ],
  },
];

// ---------------------------------------------------------------------------
// Phishing URL Analysis
// ---------------------------------------------------------------------------
const PHISHING_INDICATORS = [
  { pattern: /bit\.ly|tinyurl|goo\.gl|t\.co|rb\.gy|cutt\.ly/i, name: "URL Shortener", weight: 20 },
  { pattern: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, name: "IP Address instead of domain", weight: 40 },
  { pattern: /paypa1|paypai|googIe|micosoft|arnazon|arnaz0n/i, name: "Typosquatting", weight: 60 },
  { pattern: /login|signin|account|verify|secure|update|confirm|banking/i, name: "Suspicious keywords in URL", weight: 15 },
  { pattern: /\.tk$|\.ml$|\.ga$|\.cf$|\.gq$/i, name: "Free suspicious TLD", weight: 35 },
  { pattern: /https?:\/\/[^/]+\.[^/]+\.[^/]+\.[^/]+/i, name: "Too many subdomains", weight: 25 },
  { pattern: /@/, name: "@ symbol in URL (credential hiding)", weight: 70 },
  { pattern: /[а-яёА-ЯЁ]|[α-ωΑ-Ω]/u, name: "Homograph attack (non-ASCII chars)", weight: 80 },
  { pattern: /--|-login|-bank|-secure|-official/i, name: "Hyphen trick in domain", weight: 30 },
];

const BRAND_IMPERSONATION = [
  { brand: "Google", patterns: [/g00gle|googIe|google-/i] },
  { brand: "Microsoft", patterns: [/microsofft|m1crosoft|microsoft-/i] },
  { brand: "Apple", patterns: [/app1e|aplle|apple-id|icloud-/i] },
  { brand: "Amazon", patterns: [/arnazon|amaz0n|amazon-/i] },
  { brand: "PayPal", patterns: [/paypa1|paypai|paypal-/i] },
  { brand: "Facebook", patterns: [/faceb00k|face-book|facebook-/i] },
  { brand: "Netflix", patterns: [/netfl1x|nettflix|netflix-/i] },
  { brand: "SBI", patterns: [/sbi-|sb1|sbibanking/i] },
  { brand: "HDFC", patterns: [/hdfc-|hdfcbank-/i] },
];

// ---------------------------------------------------------------------------
// Credential Harvester Page Templates
// ---------------------------------------------------------------------------
const HARVESTER_TEMPLATES: HarvesterPageTemplate[] = [
  {
    id: "microsoft-login",
    mimics: "Microsoft Login Page",
    htmlCode: `<!-- ⚠️ EDUCATIONAL ONLY — DO NOT USE FOR MALICIOUS PURPOSES -->
<!-- This shows what a fake Microsoft login looks like -->
<!DOCTYPE html>
<html>
<head><title>Sign in to your Microsoft account</title></head>
<body style="font-family:'Segoe UI',sans-serif;background:#f2f2f2;display:flex;justify-content:center;align-items:center;height:100vh">
  <div style="background:white;padding:44px;width:440px;box-shadow:0 2px 6px rgba(0,0,0,.2)">
    <img src="https://login.microsoftonline.com/...fake-logo..." width="108" alt="Microsoft"/>
    <h2 style="font-weight:600;font-size:24px">Sign in</h2>
    <form method="POST" action="[HARVESTER_ENDPOINT]">
      <input type="email" placeholder="Email, phone, or Skype" 
             style="width:100%;padding:7px;border:1px solid #ccc;margin:10px 0"/>
      <button type="submit" style="background:#0067b8;color:white;padding:10px;width:100%;border:none;cursor:pointer">
        Next
      </button>
    </form>
    <p style="font-size:12px"><a href="#">Can't access your account?</a></p>
  </div>
</body>
</html>`,
    redFlags: [
      "URL is NOT login.microsoftonline.com or microsoft.com",
      "Microsoft logo may be slightly different",
      "Page might have SSL but certificate is for wrong domain",
      "Check browser address bar — real Microsoft uses specific domains only",
    ],
    detectionTips: [
      "Always check URL in browser before entering credentials",
      "Use password manager — it won't autofill on fake sites",
      "Enable MFA — even if credentials stolen, account is safe",
      "Bookmark official login pages and always use bookmarks",
    ],
  },
];

// ---------------------------------------------------------------------------
// Main Service
// ---------------------------------------------------------------------------
class SocialEngineerToolkitService {

  /** Get all phishing email templates */
  getPhishingTemplates(category?: PhishingEmailTemplate["category"]): PhishingEmailTemplate[] {
    if (category) {
      return PHISHING_TEMPLATES.filter(t => t.category === category);
    }
    return PHISHING_TEMPLATES;
  }

  /** Generate a customized phishing email */
  generatePhishingEmail(
    templateId: string,
    customizations: {
      targetName?: string;
      targetEmail?: string;
      phishingLink?: string;
      companyName?: string;
      senderName?: string;
    }
  ): {
    template: PhishingEmailTemplate | null;
    customizedHtml: string;
    customizedText: string;
    redFlags: string[];
  } {
    const template = PHISHING_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      return { template: null, customizedHtml: "", customizedText: "", redFlags: [] };
    }

    let html = template.htmlBody;
    let text = template.textBody;

    // Apply customizations
    if (customizations.targetName) {
      html = html.replace(/\[TARGET_NAME\]/g, customizations.targetName);
      text = text.replace(/\[TARGET_NAME\]/g, customizations.targetName);
    }
    if (customizations.phishingLink) {
      html = html.replace(/\[PHISHING_LINK\]/g, customizations.phishingLink);
      text = text.replace(/\[PHISHING_LINK\]/g, customizations.phishingLink);
    }
    if (customizations.companyName) {
      html = html.replace(/\[COMPANY\]/g, customizations.companyName);
      text = text.replace(/\[COMPANY\]/g, customizations.companyName);
    }

    return {
      template,
      customizedHtml: html,
      customizedText: text,
      redFlags: template.redFlags,
    };
  }

  /** Get pretexting scripts */
  getPretextingScripts(scenario?: string): PretextingScript[] {
    if (scenario) {
      return PRETEXTING_SCRIPTS.filter(s =>
        s.scenario.toLowerCase().includes(scenario.toLowerCase())
      );
    }
    return PRETEXTING_SCRIPTS;
  }

  /** Get smishing templates */
  getSmishingTemplates(category?: string): SmishingTemplate[] {
    if (category) {
      return SMISHING_TEMPLATES.filter(t =>
        t.category.toLowerCase() === category.toLowerCase()
      );
    }
    return SMISHING_TEMPLATES;
  }

  /** Get vishing scripts */
  getVishingScripts(): VishingScript[] {
    return VISHING_SCRIPTS;
  }

  /** Analyze a URL for phishing indicators */
  analyzePhishingUrl(url: string): PhishingUrlAnalysis {
    const indicators: string[] = [];
    const techniques: string[] = [];
    let riskScore = 0;
    let legitimateSite: string | undefined;

    // Run all indicator checks
    for (const indicator of PHISHING_INDICATORS) {
      if (indicator.pattern.test(url)) {
        indicators.push(indicator.name);
        riskScore += indicator.weight;
        techniques.push(indicator.name);
      }
    }

    // Brand impersonation check
    for (const brand of BRAND_IMPERSONATION) {
      for (const pattern of brand.patterns) {
        if (pattern.test(url)) {
          indicators.push(`Impersonating ${brand.brand}`);
          legitimateSite = brand.brand;
          riskScore += 50;
          techniques.push("Brand Impersonation");
        }
      }
    }

    // HTTPS doesn't mean safe
    if (url.startsWith("https://")) {
      // safe indicator — but reduce score slightly
      riskScore = Math.max(0, riskScore - 5);
    } else {
      indicators.push("Not using HTTPS");
      riskScore += 20;
    }

    // Long URL with many parameters
    if (url.length > 100) {
      indicators.push("Suspiciously long URL");
      riskScore += 10;
    }

    riskScore = Math.min(100, riskScore);
    const isPhishing = riskScore >= 40;

    const recommendation = isPhishing
      ? `🚨 HIGH RISK: This URL shows ${indicators.length} phishing indicators. Do NOT click or enter credentials.`
      : riskScore > 20
      ? `⚠️ SUSPICIOUS: Proceed with caution. Verify this URL independently.`
      : `✅ Appears safe, but always verify the domain carefully.`;

    return {
      url,
      isPhishing,
      riskScore,
      indicators,
      legitimateSite,
      techniques: [...new Set(techniques)],
      recommendation,
    };
  }

  /** Get credential harvester templates (for awareness training) */
  getHarvesterTemplates(): HarvesterPageTemplate[] {
    return HARVESTER_TEMPLATES;
  }

  /** Build a social engineering campaign */
  buildCampaign(options: {
    name: string;
    type: SetCampaign["type"];
    targetDescription: string;
    duration?: string;
  }): SetCampaign {
    const templateIds = options.type === "phishing"
      ? PHISHING_TEMPLATES.map(t => t.id)
      : options.type === "smishing"
      ? SMISHING_TEMPLATES.map(t => t.id)
      : [];

    return {
      id: `campaign-${Date.now()}`,
      name: options.name,
      type: options.type,
      targetDescription: options.targetDescription,
      templates: templateIds,
      timeline: [
        "Week 1: OSINT reconnaissance on target organization",
        "Week 2: Craft customized phishing/pretexting content",
        "Week 3: Launch campaign, track click rates",
        "Week 4: Report findings and awareness training",
      ],
      metrics: [
        "Click rate (% of targets who clicked)",
        "Credential submission rate",
        "Reporting rate (% who reported suspicious email)",
        "Time to click (how long before first click)",
      ],
      awareness: [
        "Follow-up training for employees who clicked",
        "Department-wise vulnerability report",
        "Policy review and update recommendations",
        "Simulated phishing frequency recommendation",
      ],
    };
  }

  /** Generate social engineering awareness quiz */
  getAwarenessQuiz(): Array<{
    question: string;
    options: string[];
    correct: number;
    explanation: string;
  }> {
    return [
      {
        question: "You receive an email from 'IT Support' asking for your password to fix an account issue. What do you do?",
        options: ["Share the password — IT needs it to fix the issue", "Ignore the email", "Call IT directly using the company's official helpdesk number", "Reply asking for their employee ID first"],
        correct: 2,
        explanation: "IT staff never need your password. Always verify by calling official helpdesk number — never numbers provided in suspicious emails.",
      },
      {
        question: "A link in an email looks like: http://paypa1.com/account-verify. What's wrong?",
        options: ["Nothing, it looks fine", "The 'l' in PayPal is replaced with '1' — it's a fake site", "HTTP is used instead of HTTPS", "Both B and C"],
        correct: 3,
        explanation: "This URL uses typosquatting (replacing 'l' with '1') AND uses insecure HTTP. Both are major red flags.",
      },
      {
        question: "Someone calls claiming to be from your bank, saying your account was hacked and asking for an OTP. What do you do?",
        options: ["Share the OTP quickly to protect your account", "Ask for their employee ID then share OTP", "Hang up and call your bank using the number on the back of your debit card", "Give them the first 3 digits to verify them"],
        correct: 2,
        explanation: "Banks NEVER ask for OTP over phone. Hang up immediately and call the official number on your card.",
      },
    ];
  }

  getStatus() {
    return {
      installed: true,
      version: "2.0.0-purejs",
      description: "Social Engineer Toolkit — Phishing templates, pretexting, smishing, vishing scripts & awareness training",
      features: [
        "Phishing email template generator",
        "Pretexting script library",
        "Smishing (SMS phishing) templates",
        "Vishing (voice phishing) scripts",
        "URL phishing analyzer",
        "Credential harvester templates (educational)",
        "Campaign builder",
        "Awareness training quiz",
      ],
      templateCount: {
        phishing: PHISHING_TEMPLATES.length,
        pretexting: PRETEXTING_SCRIPTS.length,
        smishing: SMISHING_TEMPLATES.length,
        vishing: VISHING_SCRIPTS.length,
      },
      disclaimer: "⚠️ FOR AUTHORIZED PENETRATION TESTING & SECURITY AWARENESS TRAINING ONLY!",
      engine: "pure-js",
    };
  }
}

export const socialEngineerToolkitService = new SocialEngineerToolkitService();
