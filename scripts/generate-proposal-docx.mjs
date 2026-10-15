import fs from "fs";
import path from "path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  Footer,
  Header,
  PageNumber,
  NumberFormat,
} from "docx";

const FONT_FAMILY = "Segoe UI";
const COLOR_PRIMARY = "0F172A"; // Slate 900
const COLOR_ACCENT = "D97706";  // Amber 600
const COLOR_TEXT = "334155";    // Slate 700
const COLOR_MUTED = "64748B";   // Slate 500
const COLOR_LIGHT_BG = "F8FAFC"; // Slate 50
const COLOR_BORDER = "CBD5E1";  // Slate 300

function createHeaderPara(text) {
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [
      new TextRun({
        text,
        font: FONT_FAMILY,
        size: 16, // 8pt
        color: COLOR_MUTED,
      }),
    ],
  });
}

function createFooterPara() {
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [
      new TextRun({
        text: "Page ",
        font: FONT_FAMILY,
        size: 16,
        color: COLOR_MUTED,
      }),
      new TextRun({
        children: [PageNumber.CURRENT],
        font: FONT_FAMILY,
        size: 16,
        color: COLOR_MUTED,
      }),
      new TextRun({
        text: " of ",
        font: FONT_FAMILY,
        size: 16,
        color: COLOR_MUTED,
      }),
      new TextRun({
        children: [PageNumber.TOTAL_PAGES],
        font: FONT_FAMILY,
        size: 16,
        color: COLOR_MUTED,
      }),
    ],
  });
}

function title(text) {
  return new Paragraph({
    spacing: { before: 200, after: 100 },
    children: [
      new TextRun({
        text,
        font: FONT_FAMILY,
        size: 44, // 22pt
        bold: true,
        color: COLOR_PRIMARY,
      }),
    ],
  });
}

function subtitle(text) {
  return new Paragraph({
    spacing: { before: 60, after: 120 },
    children: [
      new TextRun({
        text,
        font: FONT_FAMILY,
        size: 28, // 14pt
        color: COLOR_ACCENT,
        bold: true,
      }),
    ],
  });
}

function docMeta(metaPairs) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: metaPairs.map(([label, val]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 28, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                spacing: { before: 40, after: 40 },
                children: [
                  new TextRun({
                    text: label,
                    font: FONT_FAMILY,
                    size: 20,
                    bold: true,
                    color: COLOR_PRIMARY,
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 72, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                spacing: { before: 40, after: 40 },
                children: [
                  new TextRun({
                    text: val,
                    font: FONT_FAMILY,
                    size: 20,
                    color: COLOR_TEXT,
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    ),
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 120 },
    children: [
      new TextRun({
        text,
        font: FONT_FAMILY,
        size: 30, // 15pt
        bold: true,
        color: COLOR_PRIMARY,
      }),
    ],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    children: [
      new TextRun({
        text,
        font: FONT_FAMILY,
        size: 24, // 12pt
        bold: true,
        color: COLOR_ACCENT,
      }),
    ],
  });
}

function p(text, options = {}) {
  return new Paragraph({
    spacing: { before: 80, after: 100, line: 276 }, // 1.15 line spacing
    children: [
      new TextRun({
        text,
        font: FONT_FAMILY,
        size: 21, // 10.5pt
        color: COLOR_TEXT,
        ...options,
      }),
    ],
  });
}

function bullet(text, boldPrefix = "") {
  const children = [];
  if (boldPrefix) {
    children.push(
      new TextRun({
        text: boldPrefix + " ",
        font: FONT_FAMILY,
        size: 21,
        bold: true,
        color: COLOR_PRIMARY,
      })
    );
  }
  children.push(
    new TextRun({
      text,
      font: FONT_FAMILY,
      size: 21,
      color: COLOR_TEXT,
    })
  );

  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 40, after: 60, line: 260 },
    children,
  });
}

function calloutBox(titleText, bodyLines) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      left: { style: BorderStyle.SINGLE, size: 24, color: COLOR_ACCENT },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: COLOR_LIGHT_BG },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            children: [
              new Paragraph({
                spacing: { before: 40, after: 60 },
                children: [
                  new TextRun({
                    text: titleText,
                    font: FONT_FAMILY,
                    size: 22,
                    bold: true,
                    color: COLOR_PRIMARY,
                  }),
                ],
              }),
              ...bodyLines.map(
                (line) =>
                  new Paragraph({
                    spacing: { before: 40, after: 40 },
                    children: [
                      new TextRun({
                        text: line,
                        font: FONT_FAMILY,
                        size: 20,
                        color: COLOR_TEXT,
                      }),
                    ],
                  })
              ),
            ],
          }),
        ],
      }),
    ],
  });
}

function createTable(headers, rows, colWidths = []) {
  const tableRows = [];

  // Header row
  tableRows.push(
    new TableRow({
      tableHeader: true,
      children: headers.map((h, idx) => {
        const cellOpts = {
          shading: { type: ShadingType.CLEAR, fill: COLOR_PRIMARY },
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              children: [
                new TextRun({
                  text: h,
                  font: FONT_FAMILY,
                  size: 20,
                  bold: true,
                  color: "FFFFFF",
                }),
              ],
            }),
          ],
        };
        if (colWidths[idx]) {
          cellOpts.width = { size: colWidths[idx], type: WidthType.PERCENTAGE };
        }
        return new TableCell(cellOpts);
      }),
    })
  );

  // Data rows
  rows.forEach((row, rIdx) => {
    const isEven = rIdx % 2 === 1;
    tableRows.push(
      new TableRow({
        children: row.map((cellText, idx) => {
          const cellOpts = {
            shading: isEven
              ? { type: ShadingType.CLEAR, fill: COLOR_LIGHT_BG }
              : undefined,
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: cellText,
                    font: FONT_FAMILY,
                    size: 19,
                    color: COLOR_TEXT,
                  }),
                ],
              }),
            ],
          };
          if (colWidths[idx]) {
            cellOpts.width = { size: colWidths[idx], type: WidthType.PERCENTAGE };
          }
          return new TableCell(cellOpts);
        }),
      })
    );
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
      left: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
      right: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
    },
    rows: tableRows,
  });
}

function divider() {
  return new Paragraph({
    spacing: { before: 180, after: 180 },
    children: [
      new TextRun({
        text: "_________________________________________________________________________________",
        font: FONT_FAMILY,
        size: 16,
        color: COLOR_BORDER,
      }),
    ],
  });
}

async function generateDocx() {
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              createHeaderPara(
                "Zeus Auto Detailing Tacloban — Business Proposal and Specifications v2.1.0"
              ),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [createFooterPara()],
          }),
        },
        children: [
          title("Zeus Auto Detailing Tacloban"),
          subtitle(
            "Studio Operating System, Online Booking Platform and Tablet Kiosk System"
          ),
          p("Business Proposal and Functional Requirements Specification", {
            bold: true,
            color: COLOR_PRIMARY,
            size: 24,
          }),
          divider(),

          docMeta([
            ["Document Version:", "2.1.0"],
            ["Document Status:", "Formal Proposal and Specification Baseline"],
            ["Date Prepared:", "14 October 2026"],
            ["Target Business:", "Zeus Auto Detailing Tacloban"],
            ["Shop Location:", "Real Street, Tacloban City, Leyte, Philippines (PHT / UTC+8)"],
            ["Operating Currency:", "Philippine Peso (PHP / ₱)"],
            ["Architecture:", "Centralized Brand Decoupling (src/config/brand.ts)"],
          ]),

          divider(),

          h1("1. Executive Summary: What This System Does for Your Business"),
          p(
            "Zeus Auto Detailing provides premium automotive surface care in Tacloban City, including multi-stage paint correction, ceramic coatings, window tinting, interior sanitization, and maintenance wash packages."
          ),
          p(
            "Currently, studio operations rely on manual paper logbooks, phone calls, and unstructured Facebook Messenger chats. This operational model creates five recurring bottlenecks in daily shop life:"
          ),
          bullet(
            "Taking two vehicle appointments when only one physical detailing bay or lead detailer is free, forcing customers to wait and creating friction.",
            "1. Accidental Double-Bookings:"
          ),
          bullet(
            "Vehicle owners looking to book late in the evening or during holidays cannot get immediate slot confirmation and take their business elsewhere.",
            "2. Lost Off-Hours Bookings:"
          ),
          bullet(
            "Manually computing technician splits by the end of the week creates friction between lead detailers and assistants regarding who worked on which vehicle.",
            "3. Commission Disputes:"
          ),
          bullet(
            "Expensive ceramic vials (₱3,000–₱7,000 per bottle), compounds, and polishing pads are used without an automatic ledger, obscuring product loss or waste.",
            "4. Untracked Chemical Consumption:"
          ),
          bullet(
            "Total counter sales figures do not show true net profit once detailer commissions and consumable chemical costs are subtracted.",
            "5. Lack of Profit Clarity:"
          ),
          p(
            "To solve these operational problems permanently, we propose the development of the Automotive Detailing Studio Operating System, Online Booking Platform, and Tablet Kiosk System."
          ),

          calloutBox("The Three Core Interfaces Provided to Zeus Auto Detailing", [
            "1. Public Booking Website (Mobile-First): Customers choose their vehicle size, select detailing packages, view real-time bay availability, and get instant confirmed booking codes (ZEUS-XXXXXXXX).",
            "2. Shop Management Portal (Owner & Front Desk): A protected operations dashboard to oversee bay schedules, convert walk-ins to job orders, log payments, track stock, and review true net profits.",
            "3. Tablet Kiosk Application (Lobby & Bay Inspection): An installable full-screen tablet app for customer walk-in self-service in the waiting lounge, and technician digital walkaround vehicle inspection in detailing bays.",
          ]),

          h1("2. Phased Delivery Roadmap: Plain-English Overview"),
          p(
            "To ensure fast rollout while avoiding shop disruption, development is structured into clear operational phases. Each phase delivers working software with immediate business utility."
          ),

          createTable(
            ["Phase", "Milestone Name", "What You Get", "Daily Impact on Your Shop"],
            [
              [
                "Phase 1",
                "Public Booking Portal and Shop Operations Admin",
                "Customer booking website, 2-bay capacity engine, pricing by vehicle size, calendar agenda, walk-in job converter, manual payment tracker.",
                "Clients book online 24/7 without double-booking bays. Front desk staff sees the daily schedule at a glance and tracks every vehicle from arrival to release.",
              ],
              [
                "Phase 2",
                "Detailer Staff Management and Commissions",
                "Staff profiles, job line assignments (Lead Detailer vs. Assistant), automated percentage or flat commission calculations, payout ledgers.",
                "Eliminates manual computation disputes. Commission is calculated automatically when the job is completed and paid, giving technicians transparency.",
              ],
              [
                "Phase 3",
                "Consumables Inventory and Bill of Materials (BOM)",
                "Chemical catalog, service recipe mapping (e.g. 1 Ceramic vial per SUV), automatic inventory depletion on job completion, low-stock alerts.",
                "The system automatically deducts used ceramic coatings, compounds, and pads upon job completion. The owner knows exactly when to reorder before running out.",
              ],
              [
                "Phase 4",
                "Executive Sales Analytics and Profit Intelligence",
                "Real-time financial dashboards, net labor margin calculations, bay utilization percentages, vehicle category breakdowns, plate history tracking.",
                "The owner sees real shop profit (Revenue minus labor commissions minus chemical costs). Identifies peak days, most profitable services, and repeat customers.",
              ],
              [
                "Phase 5",
                "Production Cloud Deployment and Localized SMS",
                "Railway.app container deployment (Singapore region sin1), managed PostgreSQL database, Cloudflare custom .com domain with SSL, Semaphore SMS gateway.",
                "The system operates with fast response times (< 35ms in Tacloban) and automatically sends booking confirmation text messages to Philippine mobile numbers (+63).",
              ],
              [
                "Phase 6",
                "Tablet Kiosk Application (Lobby & Bay Modes)",
                "Dedicated installable tablet app (iPad and Android) featuring full-screen kiosk lock, customer self-service check-in, and technician vehicle walkaround inspection.",
                "Walk-in clients can browse packages and register at the lobby tablet. Detailers can perform vehicle intake condition checks and take photos directly in the bay.",
              ],
            ],
            [12, 22, 33, 33]
          ),

          h1("3. Core Features Explained for the Client"),
          h2("3.1 5-Step Customer Booking Wizard"),
          p(
            "Customers book on their smartphone or computer in under 90 seconds without needing an account or password:"
          ),
          bullet(
            "Small Sedan, Compact Crossover, Midsize/Large SUV, Pickup Truck, or Motorcycle. Prices adjust dynamically according to vehicle surface area.",
            "Step 1 — Choose Vehicle Size:"
          ),
          bullet(
            "View clear descriptions, durations, and exact Philippine Peso prices for ceramic coatings, paint correction, interior sanitization, and wash maintenance.",
            "Step 2 — Select Detailing Package:"
          ),
          bullet(
            "Customers see real-time bay availability labels (Available, 1 Bay Left, Sold Out). If both detailing bays are reserved, the time slot is locked automatically.",
            "Step 3 — Pick Date and Bay Slot:"
          ),
          bullet(
            "Name, Philippine mobile number (+63), vehicle plate number, and special instructions.",
            "Step 4 — Enter Contact Details:"
          ),
          bullet(
            "Displays the appointment summary, shop address, Google Maps link, preparation instructions, and a unique tracking reference code (ZEUS-XXXXXXXX).",
            "Step 5 — Instant Confirmed Receipt:"
          ),

          h2("3.2 2-Bay Concurrency Protection (Zero Double-Bookings)"),
          p(
            "Zeus Auto Detailing operates a fixed number of physical service bays (default: 2 bays). When a customer books a multi-hour service (for example, a 4-hour Paint Correction starting at 09:00 AM), the system locks that bay across 09:00 AM, 10:00 AM, 11:00 AM, and 12:00 PM."
          ),
          p(
            "If two clients attempt to book the final available bay at the exact same second, the database uses an atomic transaction lock (pg_advisory_xact_lock). The first client secures the slot; the second client is politely informed that the slot was just taken and invited to pick another available time without losing their contact information."
          ),

          h2("3.3 Shop Operations Calendar and Job Orders"),
          bullet(
            "Color-coded timeline showing which vehicle is inside Bay 1 and Bay 2, service progress, and assigned detailers.",
            "Day and Week Calendar:"
          ),
          bullet(
            "If a customer drives into the shop without booking online, the front desk creates a job order directly on the screen in 30 seconds.",
            "Walk-In Creation:"
          ),
          bullet(
            "Every appointment progresses through five simple stages: PENDING -> CONFIRMED -> IN PROGRESS -> COMPLETED -> PAID.",
            "Job Status Tracking:"
          ),

          h2("3.4 Automated Detailer Commission Ledger"),
          p(
            "Detailers are registered with their roles (Lead Detailer, Technician, Assistant). When assigning detailers to a job, the shop can configure commission rules (e.g. 20% to Lead, 10% to Assistant, or a flat fee like ₱800 per Ceramic Coating). Commission is generated only when the service is COMPLETED and payment is recorded. Technicians can view only their own earnings statement."
          ),

          h2("3.5 Chemical Inventory and Bill of Materials (BOM)"),
          p(
            "High-grade ceramic coatings, compounds, and applicators are cataloged with unit costs and stock quantities. Every service package has an automatic recipe (e.g. a 3-Year Ceramic Coating for SUV automatically deducts 1 bottle 9H coating, 2 applicator blocks, 4 suede cloths, and 60ml prep degreaser). Deductions happen automatically when the job is marked COMPLETED, and the owner receives low-stock warnings when items reach reorder thresholds."
          ),

          h2("3.6 Executive Financial Analytics"),
          bullet(
            "Calculates Gross Sales minus Detailer Commissions minus Material Costs, showing the owner the exact net margin.",
            "True Shop Profit:"
          ),
          bullet(
            "Shows the percentage of shop operating hours that bays were actively generating revenue versus sitting empty.",
            "Bay Utilization:"
          ),
          bullet(
            "Searches vehicle plate numbers to show past service dates, warranty records for ceramic coatings, and reminder dates for booster washes.",
            "Customer Vehicle History:"
          ),

          h1("4. Phase 6 Expansion: Tablet Kiosk Application (Lobby & Bay Inspection)"),
          p(
            "To modernize in-person shop floor operations, Phase 6 introduces an installable tablet application designed for wall-mounted or counter-standing tablets in the customer lobby, as well as ruggedized mobile tablets carried by technicians in the detailing bays."
          ),

          createTable(
            ["Operational Mode", "Hardware Deployment", "Target User", "Key Capabilities"],
            [
              [
                "Mode A: Lobby Self-Service Kiosk",
                "Mounted iPad / Android tablet in secure lobby stand",
                "Walk-in clients & waiting customers",
                "Walk-in self-registration, package comparison matrix, live bay queue transparency, PIN-protected full-screen kiosk lock.",
              ],
              [
                "Mode B: Shop Bay Inspection Mode",
                "Ruggedized handheld tablet in detailing bays",
                "Lead Detailers & Shop Managers",
                "Interactive 2D vehicle damage map, pre-existing scratch/dent logging, intake camera photo capture, customer digital signature.",
              ],
            ],
            [22, 24, 20, 34]
          ),

          p(
            "Built as a Progressive Web App (PWA), the application installs directly onto iOS and Android tablets without app store approval friction. Enlarged 64x64px touch targets ensure reliable operation even when technicians are wearing nitrile work gloves."
          ),

          h1("5. End-to-End User Journeys and Operational Flowcharts"),
          p(
            "This section details how each type of user experiences and interacts with the platform across real-world shop operations."
          ),

          h2("5.1 Journey 1: Online Customer Booking to Vehicle Handover"),
          p(
            "Flow: Discovery on website (/) -> 5-Step Booking Wizard (/book) -> Immediate Reference (ZEUS-XXXXXXXX) & SMS -> Studio Arrival at Real Street -> 2-Bay Detailing Execution -> Quality Inspection & Payment -> Post-Service Maintenance Reminder."
          ),
          createTable(
            ["Stage", "User Action", "System Action", "Touchpoint", "Operational State"],
            [
              [
                "1. Discovery",
                "Customer visits studio website on mobile or PC.",
                "Loads high-speed studio showcase with service packages and transparent pricing.",
                "Mobile Web (/)",
                "Public Exploration",
              ],
              [
                "2. Selection",
                "Customer picks vehicle size, detailing package, and desired date/time.",
                "Validates 2-bay capacity across required duration; locks slot via atomic transaction.",
                "Booking Wizard (/book)",
                "Pending Submission",
              ],
              [
                "3. Confirmation",
                "Enters name, Philippine phone number (+63), plate number, and submits.",
                "Generates reference code (ZEUS-XXXXXXXX); sends instant SMS booking confirmation.",
                "Web Receipt + SMS Alert",
                "Confirmed Booking",
              ],
              [
                "4. Arrival",
                "Vehicle arrives at Real Street studio at scheduled time.",
                "Front desk checks in vehicle; one-click conversion into active workshop job order.",
                "Admin Calendar (/admin/calendar)",
                "Vehicle Checked In",
              ],
              [
                "5. Execution",
                "Lead detailer performs work in Bay 1 or Bay 2.",
                "System tracks bay occupancy; attaches assigned technicians to service lines.",
                "Workshop Job Order",
                "In Progress",
              ],
              [
                "6. Handover",
                "Vehicle inspected; customer settles payment (Cash, GCash, Maya, Bank Transfer).",
                "Payment recorded; chemical inventory auto-depleted; technician commission credited.",
                "Admin Billing / POS",
                "Completed & Paid",
              ],
              [
                "7. Retention",
                "Periodic reminder dispatched based on ceramic coating warranty or wash interval.",
                "Automatically filters vehicle plate history and sends maintenance reminder text message.",
                "Automated SMS Gateway",
                "Customer Retained",
              ],
            ],
            [15, 25, 28, 17, 15]
          ),

          h2("5.2 Journey 2: Walk-In Customer Lobby Kiosk Journey (Phase 6)"),
          p(
            "Flow: Walk-In Arrival -> Lobby Tablet Kiosk Welcome -> Interactive Package Browsing -> Touchscreen Self-Registration -> Queue Ticket & SMS -> Front Desk Bay Assignment."
          ),
          createTable(
            ["Step", "Customer Action", "Kiosk / System Action", "Purpose / Benefit"],
            [
              [
                "1. Approach Kiosk",
                "Customer walks up to the counter/stand tablet in the waiting lounge.",
                "Full-screen kiosk display wakes with Zeus branding and package options.",
                "Immediate engagement without standing in line.",
              ],
              [
                "2. Compare Packages",
                "Taps through Ceramic Coating, Paint Correction, and Interior options.",
                "Displays side-by-side comparison with vehicle size pricing and estimated durations.",
                "Transparent pricing eliminates customer uncertainty.",
              ],
              [
                "3. Check Wait Times",
                "Views live bay occupancy indicator on screen.",
                "Kiosk queries live calendar engine and indicates next open bay time.",
                "Realistic expectation of turnaround time.",
              ],
              [
                "4. Self-Register",
                "Types vehicle plate number, customer name, and mobile number.",
                "Validates Philippine number format; issues digital queue reference.",
                "Eliminates manual paperwork for the front desk.",
              ],
              [
                "5. Confirmation",
                "Customer sits in lounge; receives queue confirmation on screen and SMS.",
                "Front desk admin portal chimes with a new walk-in alert on the active dashboard.",
                "Front desk can immediately review and assign work.",
              ],
            ],
            [16, 28, 28, 28]
          ),

          h2("5.3 Journey 3: Front Desk Manager Daily Operations Flow"),
          p(
            "Flow: Morning Agenda Audit -> Vehicle Check-In & Job Conversion -> Technician & Bay Assignment -> Add-On Logging -> Payment Collection -> Job Completion."
          ),
          createTable(
            ["Step", "Manager Action", "System Response", "Outcome"],
            [
              [
                "1. Morning Audit",
                "Opens /admin/calendar at 08:00 AM.",
                "Displays full agenda for Bay 1 and Bay 2 with scheduled vehicle sizes and durations.",
                "Organized shop floor with clear bay allocation.",
              ],
              [
                "2. Vehicle Check-In",
                "Selects arriving appointment and clicks 'Convert to Job Order'.",
                "Transitions booking status to IN_PROGRESS; creates linked workshop job order.",
                "Traceable start time and bay occupation.",
              ],
              [
                "3. Staff Assignment",
                "Assigns Lead Detailer and Assistant Detailer from the staff dropdown.",
                "Locks technician IDs to service lines for automated commission attribution.",
                "Eliminates end-of-week commission confusion.",
              ],
              [
                "4. Add-On Logging",
                "Customer requests glass water spot removal; manager adds service line.",
                "Recalculates total bill; snapshots agreed add-on price and estimated additional duration.",
                "Accurately billed work with zero unrecorded labor.",
              ],
              [
                "5. Payment Collection",
                "Customer pays via GCash or Cash; manager logs reference number.",
                "Balances invoice to ₱0.00; marks payment complete; updates daily collection ledger.",
                "Tamper-proof transaction record for owner review.",
              ],
              [
                "6. Job Completion",
                "Clicks 'Complete Job' upon vehicle release.",
                "Automatically triggers inventory BOM chemical deduction and moves commission to APPROVED.",
                "Real-time inventory and payroll synchronization.",
              ],
            ],
            [18, 28, 28, 26]
          ),

          h2("5.4 Journey 4: Lead Detailer Shop Floor & Bay Inspection Flow"),
          p(
            "Flow: Shift Login -> Digital Intake Walkaround (2D Damage Map + Photos) -> Customer Digital Signature -> Detailing Execution -> Completion Sign-Off -> Commission Credited."
          ),
          createTable(
            ["Step", "Detailer Action", "Tablet / System Response", "Shop Protection Value"],
            [
              [
                "1. View Assignment",
                "Opens technician portal on mobile or bay tablet.",
                "Shows assigned vehicle plate, car model, selected package, and bay number.",
                "Clear work instruction without verbal miscommunication.",
              ],
              [
                "2. Intake Walkaround",
                "Walks around vehicle before washing; taps 2D vehicle diagram on tablet.",
                "Records location of pre-existing paint scratches, stone chips, and door dings.",
                "Protects studio against false pre-existing damage claims.",
              ],
              [
                "3. Photo Capture",
                "Uses tablet camera to snap photos of severe paint defects.",
                "Attaches photos directly to the vehicle's permanent job record in the database.",
                "Irrefutable visual evidence accessible on customer receipt.",
              ],
              [
                "4. Customer Sign-Off",
                "Shows intake diagram to customer; customer signs on tablet glass.",
                "Captures digital signature and timestamps vehicle acceptance.",
                "Formal legal authorization before buffing or chemicals touch paint.",
              ],
              [
                "5. Service Execution",
                "Performs multi-stage compounding and ceramic application.",
                "Chemical recipe linked to job order prepares inventory ledger for automatic deduction.",
                "Controlled material consumption.",
              ],
              [
                "6. Completion",
                "Clicks 'Mark Work Complete' after final wipe-down inspection.",
                "System calculates technician commission share and displays it in detailer's ledger.",
                "Immediate earnings transparency motivates shop staff.",
              ],
            ],
            [18, 28, 28, 26]
          ),

          h2("5.5 Journey 5: End-to-End System Data Flow Architecture"),
          p(
            "Data flows continuously through an unbroken operational chain: Customer Booking / Lobby Kiosk -> Atomic Bay Capacity Lock -> Active Workshop Job Order -> Detailer Assignment & Service BOM Recipe -> In-Progress Detailing & Automatic Stock Depletion -> Payment Recording (Cash/GCash/Maya) -> Split Commission Credited to Detailers & Real-Time Executive Sales Analytics."
          ),

          h1("6. Brand Decoupling and Security Architecture"),
          bullet(
            "All business identifiers, contact numbers, studio operating hours, physical bay counts, and theme tokens reside in src/config/brand.ts. Changing shop phone numbers or bay counts requires updating this single file without touching code.",
            "Centralized Brand Decoupling:"
          ),
          bullet(
            "The customer navigation header on the public website (/ and /book) must NEVER display an 'Admin Portal' or 'Staff Login' button. Back-office access is restricted to direct URL entry (/admin/login) or an unindexed footer link.",
            "Header Security Constraint:"
          ),
          bullet(
            "All administrative pages (/admin/*) validate credentials server-side. Unauthorized requests are intercepted and redirected to /admin/login.",
            "Session Protection:"
          ),

          h1("7. Role-Based Access Control (RBAC) Matrix"),
          createTable(
            [
              "System Capability",
              "Shop Owner",
              "Front Desk Manager",
              "Inventory Custodian",
              "Technician",
              "Lobby Kiosk",
              "Public Client",
            ],
            [
              ["Submit Online Booking", "Yes", "Yes", "No", "No", "Yes", "Yes"],
              ["View Catalog & Prices", "Yes", "Yes", "Yes", "Yes", "Yes", "Yes"],
              ["View Calendar & Manage Bookings", "Yes", "Yes", "No", "Read-Only", "No", "No"],
              ["Create Walk-In Job Orders", "Yes", "Yes", "No", "No", "Limited", "No"],
              ["Perform Bay Vehicle Inspection", "Yes", "Yes", "No", "Yes", "No", "No"],
              ["Modify Catalog & Prices", "Yes", "No", "No", "No", "No", "No"],
              ["Adjust Bay Capacity & Overrides", "Yes", "Yes", "No", "No", "No", "No"],
              ["Log Customer Payments", "Yes", "Yes", "No", "No", "No", "No"],
              ["Manage Inventory & Restock", "Yes", "Read-Only", "Yes", "No", "No", "No"],
              ["Approve & Disburse Commissions", "Yes", "No", "No", "No", "No", "No"],
              ["View Personal Commission Statement", "Yes", "No", "No", "Yes", "No", "No"],
              ["View Executive Sales Analytics", "Yes", "No", "No", "No", "No", "No"],
            ],
            [26, 12, 14, 14, 12, 11, 11]
          ),

          h1("8. Technical Infrastructure, Hosting and Operating Costs"),
          p(
            "The platform runs on dedicated container infrastructure on Railway.app (Singapore sin1 region) rather than generic serverless platforms:"
          ),
          bullet(
            "Persistent Node.js containers eliminate 10–60 second serverless timeouts, allowing long-running inventory audits and monthly commission reconciliations to complete reliably.",
            "Zero Timeouts:"
          ),
          bullet(
            "Database and application run inside Railway Singapore with internal query latency under 1ms and ~35ms latency to Tacloban City.",
            "Low Latency to Tacloban:"
          ),
          bullet(
            "Persistent connection pools guarantee PostgreSQL advisory locks (pg_advisory_xact_lock) function deterministically across simultaneous requests.",
            "Advisory Locking:"
          ),

          p("Estimated Monthly Direct Cloud Infrastructure Costs (Client Accounts):", {
            bold: true,
          }),

          createTable(
            ["Component", "Provider", "Tier / Spec", "USD / mo", "PHP / mo", "Billing"],
            [
              [
                "App Container",
                "Railway.app (Singapore)",
                "1 vCPU / 1GB RAM Dedicated",
                "$5.00 – $7.00",
                "₱290 – ₱410",
                "Monthly",
              ],
              [
                "Managed Database",
                "Railway.app (Singapore)",
                "PostgreSQL, Daily Backups",
                "$5.00",
                "₱290",
                "Monthly",
              ],
              [
                "Custom .com Domain",
                "Cloudflare Registrar",
                "Wholesale Domain + SSL",
                "~$0.83 ($10/yr)",
                "~₱48 (₱580/yr)",
                "Annual",
              ],
              [
                "Philippine SMS Gateway",
                "Semaphore.co",
                "200 SMS Credits (+63)",
                "~$1.70",
                "~₱100",
                "As Consumed",
              ],
              [
                "Total Cloud Hosting",
                "—",
                "Complete Infrastructure",
                "~$12.50 – $14.50",
                "~₱728 – ₱848",
                "Monthly",
              ],
            ],
            [20, 22, 22, 12, 12, 12]
          ),

          p(
            "Ongoing System Maintenance Retainer: ₱2,500 – ₱3,500 PHP / month covering uptime monitoring, daily automated database backup verification, monthly security updates, up to 2 hours of menu/price updates, and priority operational support during shop hours."
          ),

          h1("9. Commercial Scope, Milestones and Payment Schedule"),
          createTable(
            ["Milestone", "Scope Included", "Deliverable Verification"],
            [
              [
                "Milestone 1: Web Portal & Booking UI",
                "Customer booking website (/), 5-step wizard (/book), staff login (/admin/login), studio navigation shell, brand config (src/config/brand.ts).",
                "Visual and responsive verification across desktop and mobile screens.",
              ],
              [
                "Milestone 2: Database & Concurrency Engine",
                "PostgreSQL schema, bay duration calculation, atomic advisory locking, booking reference code generator.",
                "Simultaneous reservation load tests confirming zero double-bookings.",
              ],
              [
                "Milestone 3: Studio Operations & Calendar",
                "Calendar agenda view, booking status controls, walk-in job order creation, payment logging, schedule overrides.",
                "Staff creates, reschedules, and completes sample appointments and walk-in jobs.",
              ],
              [
                "Milestone 4: Commissions & Inventory BOM",
                "Detailer roster, multi-technician job allocation, automated commission ledger, consumable catalog, service BOM auto-deductions.",
                "Completed job automatically deducts chemicals and calculates split commissions.",
              ],
              [
                "Milestone 5: Production Deployment & Handover",
                "Railway Singapore deployment, Cloudflare domain/SSL, Semaphore SMS integration, staff training, operational handover.",
                "Live booking completed on production domain with automated SMS receipt.",
              ],
              [
                "Milestone 6: Tablet Kiosk Application",
                "Progressive Web App tablet build, full-screen PIN kiosk mode for lobby, 2D vehicle damage walkaround inspection, digital customer signature.",
                "Verification on iPad/Android tablet in lobby self-service and bay inspection workflows.",
              ],
            ],
            [22, 44, 34]
          ),

          p("Payment Schedule:", { bold: true }),
          bullet("30% Initial Mobilization Deposit upon contract agreement."),
          bullet("30% Milestone 2 Progress Payment (Database and Booking Concurrency validation)."),
          bullet("20% Milestone 4 Progress Payment (Operations, Commissions, and Inventory validation)."),
          bullet("20% Final Handover Payment upon live production deployment approval (Milestone 5)."),
          p(
            "Ownership: Full source code repository access, database ownership, and cloud administrative credentials transfer to the client upon settlement of final invoices."
          ),

          h1("10. Integrated Acceptance Verification Scenarios"),
          bullet("Two customers submit simultaneous bookings for the last bay slot. The first succeeds; the second receives an immediate capacity notice while preserving form data.", "1. Simultaneous Bay Booking Protection:"),
          bullet("An 8-hour Ceramic Coating at 09:00 AM reserves 1 bay through 05:00 PM, preventing other bookings for shorter intermediate services in that bay.", "2. Multi-Hour Slot Reservation:"),
          bullet("Front desk staff enters a drive-in vehicle directly into the calendar, assigns a bay, and initiates work without requiring an online booking.", "3. Walk-In Creation:"),
          bullet("Marking a 3-Year Ceramic Coating job as COMPLETED automatically logs inventory deductions for 1 coating bottle (50ml), 2 applicator blocks, and 4 suede cloths.", "4. Automated Inventory BOM Depletion:"),
          bullet("A completed and fully paid ₱10,000 job order creates separate commission records for the Lead Detailer (₱2,000 / 20%) and Assistant (₱1,000 / 10%) with PENDING_APPROVAL status.", "5. Multi-Detailer Commission Split:"),
          bullet("A technician logging into the system cannot access sales revenue reports, modify catalog prices, or view other staff members' earnings.", "6. Technician Access Restriction:"),
          bullet("Inspecting the public website header (/ and /book) confirms that no 'Admin Portal' or 'Staff Login' button is visible to customers.", "7. No Admin Link in Public Navigation:"),
          bullet("Modifying business name, phone number, or bay count in src/config/brand.ts instantly updates all public headers, footers, and receipts without code edits.", "8. Centralized Brand Rebranding:"),
          bullet("All mobile buttons exceed the 44x44px touch target standard, and color contrast on dark surfaces exceeds the WCAG AA requirement (achieving 16.97:1 contrast).", "9. Mobile Touch Target and Contrast:"),
          bullet("An iPad or Android tablet running in kiosk mode permits walk-in customer registration and digital damage inspection with photo capture and touchscreen signature.", "10. Tablet Kiosk Operation:"),

          divider(),

          h1("11. Client Scope Acceptance and Authorization"),
          p(
            "By signing below, the client authorizes the functional specifications, phased roadmap, commercial terms, and hosting architecture detailed in this document."
          ),

          p("Client Representative:", { bold: true }),
          p("Full Name: __________________________________________________"),
          p("Title / Position: ___________________________________________"),
          p("Signature: __________________________________________________"),
          p("Date Signed: ________________________________________________"),

          divider(),

          p("Service Provider Representative:", { bold: true }),
          p("Full Name: __________________________________________________"),
          p("Title / Position: ___________________________________________"),
          p("Signature: __________________________________________________"),
          p("Date Signed: ________________________________________________"),
        ],
      },
    ],
  });

  const outDir = path.resolve("docs");
  const outFile = path.join(
    outDir,
    "zeus-auto-detailing-client-proposal-and-requirements.docx"
  );
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outFile, buffer);
  console.log(`Word document successfully generated at: ${outFile}`);
}

generateDocx().catch((err) => {
  console.error(err);
  process.exit(1);
});

