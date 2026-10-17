-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('CERAMIC_COATING', 'PAINT_CORRECTION', 'INTERIOR_DETAILING', 'EXTERIOR_WASH_SEAL', 'WINDOW_TINT_PPF');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'MANAGER', 'DETAILER');

-- CreateEnum
CREATE TYPE "InventoryTransactionType" AS ENUM ('CONSUMPTION', 'RESTOCK', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "vehicle_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sizeMultiplier" DECIMAL(5,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "category" "ServiceKind" NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "bayCapacityRequired" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_slots" (
    "id" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "maxVehicleCapacity" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "time_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_configs" (
    "id" TEXT NOT NULL,
    "defaultSlotIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "defaultBayCapacity" INTEGER NOT NULL DEFAULT 2,
    "openTime" TEXT NOT NULL DEFAULT '08:00',
    "closeTime" TEXT NOT NULL DEFAULT '17:00',
    "effectiveDate" DATE NOT NULL,

    CONSTRAINT "schedule_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_capacity_overrides" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "timeSlotId" TEXT NOT NULL,
    "maxVehicleCapacity" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "slot_capacity_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_dates" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "isFullDay" BOOLEAN NOT NULL DEFAULT true,
    "startTime" TEXT,
    "endTime" TEXT,

    CONSTRAINT "blocked_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerEmail" TEXT,
    "vehiclePlate" TEXT,
    "vehicleModel" TEXT NOT NULL,
    "vehicleCategoryId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "bookingDate" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priceSnapshot" DECIMAL(10,2) NOT NULL,
    "serviceNameSnapshot" TEXT NOT NULL,
    "vehicleCategoryNameSnapshot" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "defaultCommissionRate" DECIMAL(5,2) NOT NULL DEFAULT 0.10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_assignments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "roleInJob" TEXT NOT NULL DEFAULT 'Primary Detailer',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_payouts" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "earnedAmount" DECIMAL(10,2) NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "currentStock" DECIMAL(10,2) NOT NULL,
    "reorderLevel" DECIMAL(10,2) NOT NULL,
    "costPerUnit" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_recipes" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantityRequired" DECIMAL(8,2) NOT NULL,

    CONSTRAINT "service_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "bookingId" TEXT,
    "type" "InventoryTransactionType" NOT NULL,
    "quantity" DECIMAL(8,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_categories_slug_key" ON "vehicle_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "time_slots_dayOfWeek_startTime_key" ON "time_slots"("dayOfWeek", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_configs_effectiveDate_key" ON "schedule_configs"("effectiveDate");

-- CreateIndex
CREATE INDEX "slot_capacity_overrides_timeSlotId_idx" ON "slot_capacity_overrides"("timeSlotId");

-- CreateIndex
CREATE UNIQUE INDEX "slot_capacity_overrides_date_timeSlotId_key" ON "slot_capacity_overrides"("date", "timeSlotId");

-- CreateIndex
CREATE INDEX "blocked_dates_date_idx" ON "blocked_dates"("date");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_referenceCode_key" ON "bookings"("referenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_idempotencyKey_key" ON "bookings"("idempotencyKey");

-- CreateIndex
CREATE INDEX "bookings_bookingDate_status_startTime_endTime_idx" ON "bookings"("bookingDate", "status", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "bookings_serviceId_idx" ON "bookings"("serviceId");

-- CreateIndex
CREATE INDEX "bookings_vehicleCategoryId_idx" ON "bookings"("vehicleCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_email_key" ON "staff"("email");

-- CreateIndex
CREATE INDEX "booking_assignments_bookingId_idx" ON "booking_assignments"("bookingId");

-- CreateIndex
CREATE INDEX "booking_assignments_staffId_idx" ON "booking_assignments"("staffId");

-- CreateIndex
CREATE INDEX "commission_payouts_bookingId_idx" ON "commission_payouts"("bookingId");

-- CreateIndex
CREATE INDEX "commission_payouts_staffId_idx" ON "commission_payouts"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_sku_key" ON "inventory_items"("sku");

-- CreateIndex
CREATE INDEX "service_recipes_inventoryItemId_idx" ON "service_recipes"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "service_recipes_serviceId_inventoryItemId_key" ON "service_recipes"("serviceId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "inventory_transactions_inventoryItemId_idx" ON "inventory_transactions"("inventoryItemId");

-- CreateIndex
CREATE INDEX "inventory_transactions_bookingId_idx" ON "inventory_transactions"("bookingId");

-- AddForeignKey
ALTER TABLE "slot_capacity_overrides" ADD CONSTRAINT "slot_capacity_overrides_timeSlotId_fkey" FOREIGN KEY ("timeSlotId") REFERENCES "time_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicleCategoryId_fkey" FOREIGN KEY ("vehicleCategoryId") REFERENCES "vehicle_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_assignments" ADD CONSTRAINT "booking_assignments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_assignments" ADD CONSTRAINT "booking_assignments_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_recipes" ADD CONSTRAINT "service_recipes_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_recipes" ADD CONSTRAINT "service_recipes_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

