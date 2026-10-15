# Zeus Auto Detailing Tacloban
## Studio Operating System, Online Booking Platform and Tablet Kiosk System
### Business Proposal and Functional Requirements Specification

- **Document Version:** 2.2.0
- **Document Status:** Formal Proposal and Specification Baseline
- **Date Prepared:** 14 October 2026
- **Target Organization:** Zeus Auto Detailing Tacloban
- **Location:** Real Street, Tacloban City, Leyte, Philippines (PHT / UTC+8)
- **Currency:** Philippine Peso (PHP / ₱)
- **System Architecture:** Centralized Brand Decoupling (`src/config/brand.ts`)

---

## 1. Executive Summary: What This System Does for Your Business

### 1.1 The Business Problem in Tacloban Detailing Operations
Zeus Auto Detailing provides high-end automotive surface care in Tacloban City, including multi-stage paint correction, ceramic coatings, window film tinting, deep interior extraction, and periodic maintenance wash packages. 

Running a premium detailing studio using paper notebooks, phone calls, and unstructured Facebook Messenger chats leads to five daily operational problems:
1. **Accidental Double-Bookings:** Accepting two vehicles when only one physical bay or lead detailer is free, forcing customers to wait and damaging the studio reputation.
2. **Lost Bookings During Off-Hours:** Customers who want to schedule appointments late in the evening cannot get an instant confirmation, often taking their vehicles elsewhere.
3. **Commission Calculation Disputes:** Calculating technician earnings manually by the end of the week creates friction between lead detailers and assistants regarding who worked on which vehicle.
4. **Untracked Chemical Consumption:** Expensive ceramic coating vials (₱3,000 to ₱7,000 per bottle), polishing compounds, and pads are used without an automatic ledger, making it impossible to detect product waste or theft.
5. **Lack of Profit Clarity:** Knowing total money taken at the counter does not show actual net profit once labor commissions and chemical costs are subtracted.

### 1.2 The Proposed Solution
We propose delivering a dedicated, integrated **Automotive Detailing Studio Operating System, Online Booking Platform, and Tablet Kiosk System**. 

The system provides three synchronized operational interfaces:
- **Client Booking Website (Mobile-First):** Customers select their car type, choose a detailing package, pick an open bay slot in real time, and receive an instant booking reference code (`ZEUS-XXXXXXXX`) with clear arrival instructions.
- **Shop Management Portal (Owner & Front Desk):** A password-protected operations dashboard to manage daily bay schedules, convert online bookings or walk-ins into workshop job orders, log payments, track stock, and review business profits.
- **Tablet Kiosk Application (Lobby Self-Service & Shop Bay Inspection):** A dedicated, installable full-screen tablet application for customer walk-in self-registration in the lobby waiting area, as well as digital vehicle condition check-ins by technicians inside the detailing bays.

---

## 2. Phased Delivery Roadmap: Plain-English Overview

To minimize business disruption and allow staff to adapt gradually, development is divided into clear operational phases. Each phase delivers working software that provides immediate value.

```
PHASE 1: Core Booking & Shop Operations (Website, 2-Bay Scheduler, Job Orders)
   │
   ▼
PHASE 2: Staff Management & Commission Ledger (Technician Splits & Payouts)
   │
   ▼
PHASE 3: Inventory Control & Bill of Materials (Automatic Chemical Depletion)
   │
   ▼
PHASE 4: Executive Sales Analytics & Profit Intelligence (True Net Margins)
   │
   ▼
PHASE 5: Production Cloud Deployment (Railway Singapore, Cloudflare, SMS)
   │
   ▼
PHASE 6: Tablet Kiosk Application (Lobby Self-Service & Bay Inspection Mode)
```

### Detailed Phase Breakdown

| Phase | Milestone Name | What You Get | Day-to-Day Impact on Your Shop |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Public Booking Portal and Shop Operations Admin | Customer booking website, 2-bay capacity engine, pricing by vehicle size, calendar agenda, walk-in job order converter, manual payment tracker. | Customers can book online 24/7 without double-booking bays. Front desk staff can see the daily schedule at a glance and track every vehicle from arrival to handover. |
| **Phase 2** | Detailer Staff Management and Commissions | Staff profiles, job line assignments (Lead Detailer vs. Assistant), automated percentage or flat commission calculations, payout ledgers. | Eliminates manual computation disputes. Commission is calculated automatically when the job is completed and paid, giving technicians transparency over their earnings. |
| **Phase 3** | Consumables Inventory and Bill of Materials (BOM) | Chemical catalog, service recipe mapping (e.g. 1 Ceramic vial per SUV), automatic inventory depletion on job completion, low-stock alerts. | The system automatically deducts used ceramic coatings, compounds, and pads upon job completion. The owner knows exactly when to reorder before running out. |
| **Phase 4** | Executive Sales Analytics and Profit Intelligence | Real-time financial dashboards, net labor margin calculations, bay utilization percentages, vehicle category breakdowns, plate history tracking. | The owner sees real shop profit (Revenue minus labor commissions minus chemical costs). Identifies peak days, most profitable services, and repeat customers. |
| **Phase 5** | Production Cloud Deployment and Localized SMS | Railway.app container deployment (Singapore region `sin1`), managed PostgreSQL database, Cloudflare custom `.com` domain with SSL, Semaphore SMS gateway. | The system operates with fast response times (< 35ms in Tacloban) and automatically sends booking confirmation text messages to Philippine mobile numbers (`+63`). |
| **Phase 6** | Tablet Kiosk Application (Lobby & Bay Modes) | Dedicated installable tablet app (iPad and Android) featuring full-screen kiosk lock, customer self-service check-in, and technician vehicle walkaround inspection. | Walk-in clients can browse packages and register at the lobby tablet. Detailers can perform vehicle intake condition checks and take photos directly in the bay. |

---

## 3. Core Features Explained for the Client

### 3.1 5-Step Customer Booking Wizard
Customers book on their smartphone or computer in under 90 seconds without needing an account or password:
1. **Choose Vehicle Size:** Small Sedan, Compact Crossover, Midsize/Large SUV, Pickup Truck, or Motorcycle. Prices adjust dynamically according to vehicle surface area.
2. **Select Detailing Package:** View clear descriptions, durations, and exact Philippine Peso prices for ceramic coatings, paint correction, interior sanitization, and wash maintenance.
3. **Pick Date and Bay Slot:** Customers see real-time bay availability labels (`Available`, `1 Bay Left`, `Sold Out`). If both detailing bays are reserved, the time slot is locked automatically.
4. **Enter Vehicle and Contact Information:** Name, Philippine mobile number (`+63`), vehicle plate number, and special instructions.
5. **Instant Confirmation Receipt:** Displays the appointment summary, shop address, Google Maps link, preparation instructions, and a unique tracking reference code (`ZEUS-XXXXXXXX`).

### 3.2 2-Bay Concurrency Protection (Zero Double-Bookings)
- Zeus Auto Detailing has a fixed number of physical service bays (default: 2 bays).
- When a customer books a multi-hour service (for example, a 4-hour Paint Correction starting at 09:00 AM), the system locks that bay across 09:00 AM, 10:00 AM, 11:00 AM, and 12:00 PM.
- If two clients attempt to book the final available bay at the exact same second, the database uses an atomic transaction lock (`pg_advisory_xact_lock`). The first client secures the slot; the second client is politely informed that the slot was just taken and invited to pick another available time without losing their contact information.

### 3.3 Shop Operations Calendar and Job Orders
- **Day and Week Calendar:** Color-coded timeline showing which vehicle is inside Bay 1 and Bay 2, service progress, and assigned detailers.
- **Walk-In Creation:** If a customer drives into the shop without booking online, the front desk creates a job order directly on the screen in 30 seconds.
- **Job Status Tracking:** Every appointment progresses through five simple stages:
  $$\text{PENDING} \longrightarrow \text{CONFIRMED} \longrightarrow \text{IN PROGRESS} \longrightarrow \text{COMPLETED} \longrightarrow \text{PAID}$$

### 3.4 Automated Detailer Commission Ledger
- Detailers are registered with their roles (Lead Detailer, Technician, Assistant).
- When assigning detailers to a job, the shop can configure commission rules:
  - **Percentage Split:** For example, 20% of service labor to the Lead Detailer and 10% to the Assistant.
  - **Flat Fee:** For example, a fixed ₱800 incentive per ceramic coating application.
- Commission is only generated once the vehicle service is marked `COMPLETED` and the customer payment is recorded.
- Technicians can log in on their mobile phones to view only their personal completed jobs and accumulated payout balance, without seeing overall shop revenue.

### 3.5 Chemical Inventory and Bill of Materials (BOM)
- High-grade ceramic coatings, compounds, and applicators are cataloged with unit costs and stock quantities.
- Every service package has an automatic recipe:
  - *Example:* A "3-Year Ceramic Coating for SUV" automatically deducts 1 bottle (50ml) 9H ceramic coating, 2 applicator blocks, 4 suede cloths, and 60ml surface prep degreaser.
- When the job is marked `COMPLETED`, the items are deducted from stock automatically.
- When stock falls below a safety threshold (e.g., fewer than 3 bottles remaining), the system highlights a low-stock alert on the owner's dashboard.

### 3.6 Executive Financial Analytics
- **True Shop Profit:** Calculates Gross Sales minus Detailer Commissions minus Material Costs, showing the owner the exact net margin.
- **Bay Utilization:** Shows the percentage of shop operating hours that bays were actively generating revenue versus sitting empty.
- **Customer Vehicle History:** Searches vehicle plate numbers to show past service dates, warranty records for ceramic coatings, and reminder dates for booster washes.

---

## 4. Phase 6 Expansion: Tablet Kiosk Application (Lobby & Bay Inspection)

To modernize in-person shop floor operations, Phase 6 introduces an installable tablet application designed for wall-mounted or counter-standing tablets in the customer lobby, as well as ruggedized mobile tablets carried by technicians in the detailing bays.

```
                      ┌────────────────────────────────────────┐
                      │   Zeus Studio Tablet App (PWA / App)   │
                      └──────────────────┬─────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
   [ Mode A: Lobby Self-Service Kiosk ]            [ Mode B: Shop Bay Inspection ]
   - Counter / stand mounted tablet                - Handheld ruggedized tablet
   - Walk-in customer self-registration            - Digital vehicle damage walkaround
   - Interactive package comparisons               - Pre-existing scratch/dent logging
   - Real-time bay queue visibility                - Chemical batch verification
   - PIN-protected kiosk mode                      - Digital customer intake sign-off
```

### 4.1 Mode A: Customer Lobby Self-Service Kiosk
- **Purpose:** Placed in the customer reception area or waiting lounge on an iPad or Android tablet inside a secure enclosure.
- **Walk-In Registration:** Walk-in customers who arrive without an appointment can browse service tiers, compare packages side-by-side, check estimated wait times, and register their vehicle plate and mobile number directly on the tablet.
- **Queue Transparency:** Displays current bay activity (e.g., "Bay 1: Ceramic Coating in progress; Bay 2: Next open slot at 02:00 PM").
- **Kiosk Mode Security:** The interface locks into full screen with browser navigation, settings, and back-office administrative menus completely hidden behind a manager PIN.

### 4.2 Mode B: Shop Floor Detailer Bay Inspection Mode
- **Purpose:** Carried by the lead technician or shop manager during the initial vehicle intake walkaround.
- **Digital Condition Check-In:** Detailers inspect the vehicle before washing or polishing, tapping a 2D vehicle diagram to mark pre-existing paint chips, deep scratches, acid rain water spots, curb rash on wheels, or interior upholstery stains.
- **Photo Documentation:** Detailers can take intake photographs of existing imperfections directly using the tablet camera, attaching the images to the customer's job order to prevent false damage claims upon vehicle handover.
- **Digital Sign-Off:** The customer reviews the recorded vehicle condition on the tablet screen and signs with their finger before work commences.

### 4.3 Technical Delivery of the Tablet System
- **Progressive Web App (PWA) Architecture:** Built on standard web technology, allowing the app to be installed directly on iOS (iPadOS) and Android devices without mandatory third-party app store subscription overhead.
- **Touch Targets for Shop Floor Use:** Interface buttons are enlarged to a minimum of 64x64 pixels with generous spacing, ensuring easy operation even when technicians are wearing nitrile work gloves.
- **Offline Tolerance:** Temporary network interruptions in enclosed detailing bays will not freeze the tablet interface; intake inspection data synchronizes automatically once network connection re-establishes.

---

## 5. End-to-End User Journeys and Operational Flowcharts

This section details how each type of user experiences and interacts with the platform across real-world shop operations.

### 5.1 Journey 1: Online Customer Booking to Vehicle Handover

```
[ 1. Discovery ] ──► [ 2. Booking Wizard ] ──► [ 3. Confirmation ] ──► [ 4. Shop Arrival ]
Customer visits     Selects car class,        Instant code            Vehicle arrives,
homepage (/)        package, date & slot      (ZEUS-XXXXXXXX)         front desk checks
                    (2-Bay Engine check)      & SMS confirmation      in job order
                                                                             │
                                                                             ▼
[ 7. Re-Engagement ] ◄── [ 6. Handover ] ◄── [ 5. Inspection ] ◄── [ 4b. Bay Detailing ]
Automated reminder       Customer pays,       Lead Detailer logs      Vehicle enters bay,
sent for maintenance     receives receipt,    work complete;          chemical recipe
wash or warranty check   takes delivery       clears quality check    auto-depletes stock
```

| Stage | User Action | System Action | Touchpoint | Operational State |
| :--- | :--- | :--- | :--- | :--- |
| **1. Discovery** | Customer visits studio website on mobile or PC. | Loads high-speed studio showcase with service packages and transparent pricing. | Mobile Web (`/`) | Public Exploration |
| **2. Selection** | Customer picks vehicle size, detailing package, and desired date/time. | Validates 2-bay capacity across required duration; locks slot via atomic transaction. | Booking Wizard (`/book`) | Pending Submission |
| **3. Confirmation** | Enters name, Philippine phone number (`+63`), plate number, and submits. | Generates reference code (`ZEUS-XXXXXXXX`); sends instant SMS booking confirmation. | Web Receipt + SMS Alert | Confirmed Booking |
| **4. Arrival** | Vehicle arrives at Real Street studio at scheduled time. | Front desk checks in vehicle; one-click conversion into active workshop job order. | Admin Calendar (`/admin/calendar`) | Vehicle Checked In |
| **5. Execution** | Lead detailer performs work in Bay 1 or Bay 2. | System tracks bay occupancy; attaches assigned technicians to service lines. | Workshop Job Order | In Progress |
| **6. Handover** | Vehicle inspected; customer settles payment (Cash, GCash, Maya, Bank Transfer). | Payment recorded; chemical inventory auto-depleted; technician commission credited. | Admin Billing / POS | Completed & Paid |
| **7. Retention** | Periodic reminder dispatched based on ceramic coating warranty or wash interval. | Automatically filters vehicle plate history and sends maintenance reminder text message. | Automated SMS Gateway | Customer Retained |

---

### 5.2 Journey 2: Walk-In Customer Lobby Kiosk Journey (Phase 6)

```
[ 1. Walk-In Arrival ] ──► [ 2. Kiosk Welcome ] ──► [ 3. Self-Registration ]
Client enters lobby         Tablet displays packages,   Client selects package, enters
waiting lounge              wait times & bay status     plate number and mobile phone
                                                               │
                                                               ▼
[ 6. Bay Entry ] ◄─────── [ 5. Desk Assignment ] ◄─── [ 4. Queue Ticket ]
Vehicle pulled into bay;  Front desk confirms job,    Digital queue ticket on screen;
detailer starts intake    assigns bay & lead staff    SMS confirms position in line
```

| Step | Customer Action | Kiosk / System Action | Purpose / Benefit |
| :--- | :--- | :--- | :--- |
| **1. Approach Kiosk** | Customer walks up to the counter/stand tablet in the waiting lounge. | Full-screen kiosk display wakes with Zeus branding and package options. | Immediate engagement without standing in line. |
| **2. Compare Packages** | Taps through Ceramic Coating, Paint Correction, and Interior options. | Displays side-by-side comparison with vehicle size pricing and estimated durations. | Transparent pricing eliminates customer uncertainty. |
| **3. Check Wait Times** | Views live bay occupancy indicator on screen. | Kiosk queries live calendar engine and indicates next open bay time. | Realistic expectation of turnaround time. |
| **4. Self-Register** | Types vehicle plate number, customer name, and mobile number. | Validates Philippine number format; issues digital queue reference. | Eliminates manual paperwork for the front desk. |
| **5. Queue Confirmation** | Customer sits in lounge; receives queue confirmation on screen and SMS. | Front desk admin portal chimes with a new walk-in alert on the active dashboard. | Front desk can immediately review and assign work. |

---

### 5.3 Journey 3: Front Desk Manager Daily Operations Flow

```
[ Morning Review ] ──► [ Vehicle Intake ] ──► [ Service Add-Ons ] ──► [ Payment & Release ]
Checks day calendar,   Converts online or     Logs customer-approved   Collects payment,
bay schedules and      walk-in booking into   extra services           closes job, verifies
staff assignments      active Job Order       to active job card       stock & commissions
```

| Step | Manager Action | System Response | Outcome |
| :--- | :--- | :--- | :--- |
| **1. Morning Audit** | Opens `/admin/calendar` at 08:00 AM. | Displays full agenda for Bay 1 and Bay 2 with scheduled vehicle sizes and durations. | Organized shop floor with clear bay allocation. |
| **2. Vehicle Check-In** | Selects arriving appointment and clicks "Convert to Job Order". | Transitions booking status to `IN_PROGRESS`; creates linked workshop job order. | Traceable start time and bay occupation. |
| **3. Staff Assignment** | Assigns Lead Detailer and Assistant Detailer from the staff dropdown. | Locks technician IDs to service lines for automated commission attribution. | Eliminates end-of-week commission confusion. |
| **4. Add-On Logging** | Customer requests glass water spot removal; manager adds service line. | Recalculates total bill; snapshots agreed add-on price and estimated additional duration. | Accurately billed work with zero unrecorded labor. |
| **5. Payment Collection** | Customer pays via GCash or Cash; manager logs reference number. | Balances invoice to ₱0.00; marks payment complete; updates daily collection ledger. | Tamper-proof transaction record for owner review. |
| **6. Job Order Completion** | Clicks "Complete Job" upon vehicle release. | Automatically triggers inventory BOM chemical deduction and moves commission to `APPROVED`. | Real-time inventory and payroll synchronization. |

---

### 5.4 Journey 4: Lead Detailer Shop Floor & Bay Inspection Flow

```
[ Shift Login ] ──► [ Digital Inspection ] ──► [ Service Execution ] ──► [ Earnings Review ]
Detailer views      Performs vehicle walkaround;   Applies coating /     Checks personal
assigned jobs       marks scratches on tablet;     polishing following   statement for earned
on mobile/tablet    captures intake photos         studio checklist      commission balance
```

| Step | Detailer Action | Tablet / System Response | Shop Protection Value |
| :--- | :--- | :--- | :--- |
| **1. View Assignment** | Opens technician portal on mobile or bay tablet. | Shows assigned vehicle plate, car model, selected package, and bay number. | Clear work instruction without verbal miscommunication. |
| **2. Intake Walkaround** | Walks around vehicle before washing; taps 2D vehicle diagram on tablet. | Records location of pre-existing paint scratches, stone chips, and door dings. | Protects studio against false pre-existing damage claims. |
| **3. Photo Capture** | Uses tablet camera to snap photos of severe paint defects. | Attaches photos directly to the vehicle's permanent job record in the database. | Irrefutable visual evidence accessible on customer receipt. |
| **4. Customer Sign-Off** | Shows intake diagram to customer; customer signs on tablet glass. | Captures digital signature and timestamps vehicle acceptance. | Formal legal authorization before buffing or chemicals touch paint. |
| **5. Service Execution** | Performs multi-stage compounding and ceramic application. | Chemical recipe linked to job order prepares inventory ledger for automatic deduction. | Controlled material consumption. |
| **6. Completion & Commission**| Clicks "Mark Work Complete" after final wipe-down inspection. | System calculates technician commission share and displays it in detailer's ledger. | Immediate earnings transparency motivates shop staff. |

---

### 5.5 Journey 5: End-to-End System Data Flow Architecture

The diagram below demonstrates how data flows continuously through the platform, connecting customer demand directly to inventory deductions, payroll ledgers, and executive intelligence:

```
                  ┌──────────────────────────────────────────────┐
                  │   Customer Booking (Online / Lobby Kiosk)    │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │   Bay Concurrency Engine (Atomic Locking)    │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │      Active Job Order & Bay Allocation       │
                  └──────────────┬────────────────┬──────────────┘
                                 │                │
                 ┌───────────────┘                └───────────────┐
                 ▼                                                ▼
  ┌──────────────────────────────┐                ┌──────────────────────────────┐
  │   Staff Detailer Allocation  │                │   Service BOM Chemical Recipe│
  └──────────────┬───────────────┘                └───────────────┬──────────────┘
                 │                                                │
                 ▼                                                ▼
  ┌──────────────────────────────┐                ┌──────────────────────────────┐
  │   Completed Detailing Work   │                │   Auto-Deducted Stock Ledger │
  └──────────────┬───────────────┘                └───────────────┬──────────────┘
                 │                                                │
                 ▼                                                │
  ┌──────────────────────────────┐                                │
  │ Payment Recorded (Cash/GCash)│                                │
  └──────────────┬───────────────┘                                │
                 │                                                │
         ┌───────┴────────────────────────┐                       │
         ▼                                ▼                       │
┌──────────────────────────────┐   ┌──────────────────────────────┴──────────────┐
│ Detailer Commission Credited │   │  Executive Sales & Profit Analytics Engine  │
│ (Lead vs. Assistant Splits)  │   │  (Gross Sales - Commissions - Chemical Cost)│
└──────────────────────────────┘   └─────────────────────────────────────────────┘
```

---

## 6. Architecture, Brand Decoupling and Security Architecture

### 6.1 Centralized Brand Decoupling (`src/config/brand.ts`)
All business names, contact details, operating hours, and shop parameters are kept separate from the system code in a single configuration file:

```typescript
export const brandConfig = {
  businessName: "Zeus Auto Detailing",
  shortName: "Zeus Detailing",
  shopName: "Zeus Auto Detailing",
  tagline: "Precision care. Unmatched finish.",
  location: "Tacloban City, Leyte",
  locationFull: "Tacloban City, Leyte, Philippines",
  address: "2nd Floor, XYZ Building, Real Street, Tacloban City, Leyte 6500",
  contactPhone: "+63 917 123 4567",
  operatingHours: "MON — SAT · 08:00 AM — 05:00 PM",
  currency: "PHP",
  currencySymbol: "₱",
  timezone: "Asia/Manila",
  defaultBays: 2,
  locale: "en-PH",
} as const;
```

If Zeus Auto Detailing updates its telephone number, opens additional bays, or relocates to another address in Tacloban, updating this single file automatically updates the entire platform.

### 6.2 Strict Route Separation and Public Header Security
To maintain an exclusive customer presentation and protect shop records from unauthorized access:
- **No Admin Button on Public Pages:** The customer navigation header on the public website (`/` and `/book`) must **never** show an "Admin Portal" or "Staff Login" button.
- **Protected URLs:** Staff access is restricted to direct URL entry (`/admin/login`) or a discreet, unindexed text link in the footer.
- **Server-Side Session Protection:** Every administrative page (`/admin/bookings`, `/admin/calendar`, `/admin/detailers`, `/admin/inventory`, `/admin/analytics`) validates authenticated credentials on the server. Unauthorized access attempts are redirected to `/admin/login`.

---

## 7. Human-Computer Interaction (HCI) and UX Principles

The system interface is engineered to eliminate customer mistakes, provide rapid response on mobile devices, and support high-contrast readability in bright shop lighting.

### 7.1 Fitts's Law (Thumb-Friendly Touch Targets)
- Every interactive button and card has a minimum hit area of 44x44 CSS pixels on customer mobile phones and 64x64 CSS pixels on shop tablets.
- Primary buttons ("Select Slot", "Proceed to Details", "Confirm Booking") span 100% of the mobile screen width at the bottom of the viewport for easy one-handed thumb interaction.

### 7.2 Hick's Law (Progressive Disclosure)
- Instead of overwhelming clients with a long form, the booking flow is divided into 5 progressive steps. Each step requires only one clear decision before the next step appears.
- Step selections are saved in memory; customers can navigate backward to adjust vehicle category or package without losing their typed contact details.

### 7.3 Jakob's Law (Familiar Philippine Conventions)
- Mobile numbers automatically validate and format to the standard Philippine convention (`+63 9XX XXX XXXX`).
- Currency formatting displays standard Philippine Peso notation (`₱1,500.00`).
- Color coding uses universally recognized cues: Green indicates confirmed or available; Amber indicates limited capacity (1 Bay Remaining); Red indicates sold-out or closed dates.

### 7.4 Visual Identity: Clinical Dark Industrial Aesthetic
- Designed to match the aesthetic of modern, enclosed detailing bays: deep obsidian black surfaces (`#09090b`), slate gray card borders (`#18181b`, `#27272a`), crisp white text (`#fafafa` with an ultra-high 16.97:1 contrast ratio), and warm amber accent lighting (`#f59e0b` / `#fbbf24`).
- High-contrast visual styling ensures screen readability even when viewed under direct 5000K detailing bay floodlights.

---

## 8. Complete Functional Requirements Checklist

### 8.1 Booking and Multi-Bay Concurrency (Phase 1)
- **BR-01 Vehicle Pricing Multipliers:** Supports Sedan, Compact Crossover, Midsize/Full-Size SUV, Pickup, and Motorcycle categories with dynamic package pricing.
- **BR-02 Price Snapshots:** The agreed package price and duration are permanently locked into the booking record upon submission; subsequent price updates in the catalog do not alter historical records.
- **BR-03 Real-Time Capacity Checking:** Automatically calculates available bay slots by checking configured bay capacity minus active bookings spanning that duration.
- **BR-04 Atomic Collision Prevention:** Uses PostgreSQL advisory transaction locks (`pg_advisory_xact_lock`) to prevent concurrent double-booking of the last available bay.
- **BR-05 Unique Reference Generation:** Issues an 8-character reference code with the studio prefix (`ZEUS-XXXXXXXX`) upon successful appointment creation.
- **BR-06 Calendar Blackouts and Capacity Overrides:** Shop managers can mark holidays or shop closures, or reduce bay capacity for specific dates.

### 8.2 Shop Operations and Job Orders (Phase 1)
- **OP-01 Studio Calendar View:** Visual calendar displaying appointments across Day, Week, and Month views with bay allocation.
- **OP-02 Walk-In Order Creation:** Immediate job order generation for drive-in clients without requiring online appointment lead times.
- **OP-03 Job Order State Machine:** Formal lifecycle management (`PENDING`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`).
- **OP-04 Additional Service Add-ons:** Ability to attach supplementary services (e.g. headlight restoration, glass rain repellent) to active jobs with recorded client approval.
- **OP-05 Payment Logging:** Manual recording of payments received (Cash, GCash, Maya, Bank Transfer) with receipt reference and deposit tracking.

### 8.3 Detailer Staff and Commissions (Phase 2)
- **ST-01 Detailer Profiles:** Staff registry with role classifications (Lead Detailer, Technician, Assistant) and active status.
- **ST-02 Job Line Staff Allocation:** Assign primary and secondary technicians to individual service packages on a job order.
- **ST-03 Commission Calculation Engine:** Configurable percentage splits (e.g. 20% Lead, 10% Assistant) or flat PHP rates per service tier.
- **ST-04 Commission Trigger:** Earnings become eligible only after the service is marked `COMPLETED` and payment is fully settled.
- **ST-05 Payout Status Ledger:** Explicit payout tracking (`PENDING_APPROVAL`, `APPROVED`, `DISBURSED`) with payment date and method.
- **ST-06 Role-Restricted Earnings Statement:** Detailers can only log in to view their personal completed jobs and commission statement.

### 8.4 Consumables Inventory and Bill of Materials (Phase 3)
- **IN-01 Consumable Catalog:** Registry for ceramic coating vials, compounds, pads, degreasers, and microfibers with unit costs.
- **IN-02 Service BOM Recipes:** Mapping of exact chemical quantities consumed per detailing package by vehicle size.
- **IN-03 Automatic Stock Depletion:** Automatic reduction of chemical quantities in inventory upon job completion.
- **IN-04 Low-Stock Alerts:** Dashboard warnings when consumable levels fall below configured safety reorder thresholds.
- **IN-05 Stock Adjustment Auditing:** Manual stock balance changes require an authorized manager note explaining breakage, spill, or restocking.

### 8.5 Sales Analytics and Business Intelligence (Phase 4)
- **SA-01 Revenue Breakdown:** Clear separation of Gross Billed Revenue, Net Labor Margin (after commissions), and Material Costs.
- **SA-02 Collection Reconciliation:** Summary of collected cash, e-wallet, and bank transfer payments versus outstanding balances.
- **SA-03 Bay Utilization Percentage:** Percentage of operating bay hours actively generating revenue.
- **SA-04 Plate Retention Tracking:** Customer search by vehicle plate number displaying complete service and warranty history.

### 8.6 Tablet Kiosk and Bay Inspection Application (Phase 6)
- **KIOSK-01 Lobby Full-Screen Kiosk Mode:** Touch-optimized interface for walk-in self-service booking with browser controls locked behind a manager PIN.
- **KIOSK-02 Real-Time Bay Status Display:** Visual screen showing live bay queues and estimated waiting times for walk-in clients.
- **KIOSK-03 Bay Vehicle Walkaround Inspection:** 2D interactive vehicle diagram allowing detailers to tap and log pre-existing scratches, paint swirls, and dents.
- **KIOSK-04 Intake Camera Capture:** Direct capture and attachment of vehicle condition photos to the job order.
- **KIOSK-05 Customer Digital Signature:** Touchscreen customer signature capture approving the intake condition report and requested service scope.

---

## 9. Role-Based Access Control (RBAC) Matrix

| System Action | Shop Owner | Front Desk Manager | Inventory Custodian | Detailer / Technician | Lobby Kiosk (Phase 6) | Public Customer |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Submit Online Booking | Yes | Yes | No | No | **Yes** | **Yes** |
| View Public Catalog & Pricing | Yes | Yes | Yes | Yes | **Yes** | **Yes** |
| View Calendar & Manage Bookings | **Yes** | **Yes** | No | Read-Only | No | No |
| Create Walk-In Job Orders | **Yes** | **Yes** | No | No | Limited | No |
| Perform Bay Vehicle Inspection | **Yes** | **Yes** | No | **Yes** | No | No |
| Modify Service Catalog & Prices | **Yes** | No | No | No | No | No |
| Adjust Bay Capacity & Overrides | **Yes** | **Yes** | No | No | No | No |
| Log Customer Payments | **Yes** | **Yes** | No | No | No | No |
| Manage Inventory & Restock | **Yes** | Read-Only | **Yes** | No | No | No |
| Approve & Disburse Commissions | **Yes** | No | No | No | No | No |
| View Personal Commission Statement | **Yes** | No | No | **Yes** | No | No |
| View Executive Sales Analytics | **Yes** | No | No | No | No | No |

---

## 10. Technical Infrastructure, Hosting and Operating Costs

### 10.1 Why Railway.app (Singapore `sin1`) is Selected
To guarantee dependable operations, fast response times in Tacloban, and zero double-booking errors, the platform runs on dedicated container infrastructure rather than generic serverless platforms:
1. **No Execution Timeouts:** Serverless hosts (like Vercel) terminate functions after 10 to 60 seconds, which disrupts inventory stock recalculations and monthly commission reports. Railway containers run persistently.
2. **Sub-Millisecond Database Queries:** The application and PostgreSQL database both reside in Railway's Singapore region (`sin1`), achieving internal network speeds under 1 millisecond and ~35ms latency to Tacloban City.
3. **Dependable Concurrency Locking:** PostgreSQL advisory transaction locks (`pg_advisory_xact_lock`) remain held throughout the reservation validation, guaranteeing that two customers cannot reserve the same bay simultaneously.

### 10.2 Monthly Direct Cloud Operating Costs
The client maintains direct ownership of all cloud hosting accounts. Recurring cloud fees are paid directly to the service providers:

| Service Component | Provider | Configuration / Tier | Estimated Monthly (USD) | Estimated Monthly (PHP) | Billing Cycle |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Application Container | Railway.app (Singapore) | 1 vCPU / 1GB RAM Dedicated Container | $5.00 – $7.00 | ₱290 – ₱410 | Monthly |
| Managed Database | Railway.app (Singapore) | PostgreSQL, Daily Automated Backups | $5.00 | ₱290 | Monthly |
| Custom `.com` Domain | Cloudflare Registrar | Wholesale Domain with Free SSL & DDoS | ~$0.83 ($10/yr) | ~₱48 (₱580/yr) | Annual |
| Philippine SMS Gateway | Semaphore.co | 200 Transactional SMS Credits (`+63`) | ~$1.70 | ~₱100 | As Consumed |
| **Total Cloud Hosting** | — | **Complete Studio Infrastructure** | **~$12.50 – $14.50** | **~₱728 – ₱848** | **Monthly** |

*Note: Indicative currency exchange rate calculated at $1.00 USD = ₱58.00 PHP.*

### 10.3 Monthly System Maintenance Retainer
To ensure system security, automated backup verification, and technical assistance during business hours, the developer provides an ongoing maintenance retainer:
- **Proposed Retainer Fee:** **₱2,500 – ₱3,500 PHP / month**
- **Retainer Inclusions:**
  - **Uptime Monitoring:** Surveillance of application and database health on Railway.app.
  - **Daily Backup Auditing:** Periodic testing of automated PostgreSQL database backups to ensure zero data loss.
  - **Security Updates:** Regular patching of software libraries, Node.js security updates, and SSL certificate maintenance.
  - **Catalog Updates:** Up to 2 hours of monthly price updates, package additions, or staff roster adjustments.
  - **Priority Operational Support:** Direct phone and messaging support for shop operational issues during business hours (Monday to Saturday, 08:00 AM – 05:00 PM PHT).

---

## 11. Commercial Scope, Milestones and Payment Terms

### 11.1 Delivery Milestones

| Milestone | Scope Included | Acceptance Deliverable |
| :--- | :--- | :--- |
| **Milestone 1: Web Portal & Booking UI** | Customer booking website (`/`), 5-step wizard (`/book`), staff login (`/admin/login`), studio navigation shell, brand config (`src/config/brand.ts`). | Complete visual verification on desktop and mobile viewports with zero errors. |
| **Milestone 2: Database & Bay Concurrency Engine** | PostgreSQL database models, duration reservation calculation, atomic advisory locking, booking reference generator. | Concurrency testing confirming zero double-bookings when testing simultaneous requests. |
| **Milestone 3: Studio Operations & Calendar** | Calendar agenda view, booking status management, walk-in job order creation, payment logging, schedule overrides. | Staff creates, reschedules, and completes sample appointments and walk-in jobs. |
| **Milestone 4: Staff Commissions & Inventory BOM** | Detailer roster, multi-technician job allocation, automated commission ledger, consumable stock catalog, service BOM auto-deductions. | Completed service job automatically deducts chemical stock and calculates detailer commission. |
| **Milestone 5: Production Deployment & Handover** | Railway Singapore deployment, Cloudflare domain/SSL configuration, Semaphore SMS integration, staff training, operational handover. | Live booking completed on production domain with automated SMS receipt. |
| **Milestone 6: Tablet Kiosk Application** | Progressive Web App tablet build, full-screen PIN kiosk mode for lobby, 2D vehicle damage walkaround inspection, digital customer signature. | Verification on iPad/Android tablet in lobby self-service and bay inspection workflows. |

### 11.2 Commercial Payment Schedule
- **30% Initial Mobilization Deposit** upon contract agreement.
- **30% Milestone 2 Progress Payment** upon validation of Database and Booking Concurrency.
- **20% Milestone 4 Progress Payment** upon validation of Operations, Commissions, and Inventory BOM.
- **20% Final Handover Payment** upon live production deployment approval (Milestone 5).
- *Milestone 6 (Tablet Kiosk Application) may be delivered as part of the core project scope or as a secondary release following operational baseline acceptance.*
- **Ownership:** Complete source code repository access, database credentials, and cloud account ownership are transferred to the client upon settlement of final invoices.

---

## 12. Integrated Acceptance Verification Scenarios

Prior to final production deployment, the platform must satisfy the following ten concrete acceptance scenarios:

1. **Simultaneous Bay Booking Protection:** Two clients submit bookings for the last open bay at the exact same time. The first booking is confirmed; the second receives an immediate notification that the bay was just taken, while preserving their entered contact information.
2. **Multi-Hour Service Slot Blocking:** A customer books an 8-hour Ceramic Coating starting at 09:00 AM. The system blocks 1 bay across all consecutive slots through 05:00 PM, preventing other customers from booking that bay for intermediate services.
3. **Walk-In Creation Without Online Booking:** Front desk staff enters a walk-in vehicle directly into the calendar, assigns a bay, and initiates work without requiring an advance online appointment.
4. **Automated Inventory BOM Depletion:** Marking a 3-Year Ceramic Coating job as `COMPLETED` automatically logs inventory deductions for 1 coating bottle (50ml), 2 applicator blocks, and 4 suede cloths.
5. **Multi-Detailer Commission Split:** A completed and fully paid ₱10,000 job order automatically creates separate commission records for the Lead Detailer (₱2,000 / 20%) and Assistant (₱1,000 / 10%) with `PENDING_APPROVAL` status.
6. **Technician Access Restriction:** A technician logging into the system cannot access sales revenue reports, modify catalog prices, or view other staff members' earnings.
7. **No Admin Link in Public Navigation:** Inspecting the public website header (`/` and `/book`) confirms that no "Admin Portal" or "Staff Login" button is visible to customers.
8. **Brand Configuration Update Test:** Modifying business name, phone number, or bay count in `src/config/brand.ts` instantly updates all public headers, footers, and receipts without code edits.
9. **Mobile Touch Target and Contrast Verification:** All mobile buttons exceed the 44x44px touch target standard, and color contrast on dark surfaces exceeds the WCAG AA requirement (achieving 16.97:1 contrast).
10. **Tablet Kiosk Operation (Phase 6):** An iPad or Android tablet running in kiosk mode permits walk-in customer registration and digital damage inspection with photo capture and touchscreen signature without exiting to the tablet operating system.

---

## 13. Client Scope Acceptance and Authorization

By signing below, the client authorizes the functional specifications, phased roadmap, commercial terms, and hosting architecture detailed in this document.

<br />

**Client Representative:**  
Full Name: __________________________________________________  
Title / Position: ___________________________________________  
Signature: __________________________________________________  
Date Signed: ________________________________________________  

<br />

**Service Provider Representative:**  
Full Name: __________________________________________________  
Title / Position: ___________________________________________  
Signature: __________________________________________________  
Date Signed: ________________________________________________  
