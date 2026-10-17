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

- Node.js >= 22
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
npm ci
```

3. Setup environment variables:
```bash
cp .env.example .env
# Set DATABASE_URL in .env
```

4. Initialize database:
```bash
npx prisma migrate deploy
npx prisma generate
```

   Optional: seed the draft service catalog. This needs the client catalog document, which is not in the repository (ask the Lead Engineer). See [prisma/catalog/README.md](prisma/catalog/README.md).

5. Run development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

Checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`) and contributor rules are in [AGENTS.md](AGENTS.md).
