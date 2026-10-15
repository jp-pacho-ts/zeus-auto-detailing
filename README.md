# zeus-auto-detailing

Automotive Detailing Studio Operating System & Online Booking Platform for **Zeus Auto Detailing** (Tacloban City, Leyte).

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **UI & Styling:** React 19, Tailwind CSS, Lucide React
- **Language:** TypeScript
- **Database & ORM:** PostgreSQL, Prisma ORM
- **Validation:** Zod

## Features

- **Public Studio Portal:** Responsive marketing showcase, service catalog, verified studio information, and an interactive Bay & Duration Estimator.
- **5-Step Booking Wizard:** Step-by-step customer booking flow with real-time multi-bay slot availability checks and dynamic capacity badges.
- **Concurrency-Safe Availability Engine:** Real-time slot calculation with PostgreSQL transaction advisory locks to eliminate overbooking.
- **Studio Operations Admin Portal:** Protected operations interface for bookings management, schedule & bay controls, detailer roster, and inventory tracking.

## Getting Started

### Prerequisites

- Node.js >= 20.9.0
- npm
- PostgreSQL database

### Installation

1. Clone repository:
```bash
git clone git@github.com:jp-pacho-ts/zeus-auto-detailing.git
cd zeus-auto-detailing
```

2. Install dependencies:
```bash
npm install
```

3. Setup environment variables:
```bash
cp .env.example .env
# Update DATABASE_URL and admin credentials in .env
```

4. Initialize database:
```bash
npx prisma generate
npx prisma db push
npm run prisma:seed # or npx tsx prisma/seed.ts
```

5. Run development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.
