import { PrismaClient, ServiceKind, StaffRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting Zeus Auto Detailing database seed...");

  // ---------------------------------------------------------------------------
  // 1. Vehicle Categories
  // ---------------------------------------------------------------------------
  const vehicleCategories = [
    {
      slug: "SEDAN",
      name: "Sedan",
      description: "Standard 4-door compact and midsize sedans and hatchbacks",
      sizeMultiplier: 1.0,
      sortOrder: 1,
    },
    {
      slug: "SUV_CROSSOVER",
      name: "SUV / Crossover",
      description: "Compact & midsize SUVs, crossovers, and compact wagons",
      sizeMultiplier: 1.2,
      sortOrder: 2,
    },
    {
      slug: "PICKUP_VAN",
      name: "Pickup / Van",
      description: "Full-size pickup trucks, passenger vans, and large 7-seater SUVs",
      sizeMultiplier: 1.35,
      sortOrder: 3,
    },
    {
      slug: "MOTORCYCLE_SPECIALTY",
      name: "Motorcycle",
      description: "Big bikes, maxi-scooters, and specialty two-wheelers",
      sizeMultiplier: 0.75,
      sortOrder: 4,
    },
  ];

  console.log("Seeding vehicle categories...");
  for (const cat of vehicleCategories) {
    await prisma.vehicleCategory.upsert({
      where: { slug: cat.slug },
      update: {
        name: cat.name,
        description: cat.description,
        sizeMultiplier: cat.sizeMultiplier,
        sortOrder: cat.sortOrder,
      },
      create: cat,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Core Detailing Services
  // ---------------------------------------------------------------------------
  const services = [
    {
      slug: "signature-ceramic-coating",
      name: "Signature Ceramic Coating",
      description:
        "Multi-year 9H nano-ceramic surface protection with deep hydrophobics, UV shielding, and mirror-grade gloss.",
      category: ServiceKind.CERAMIC_COATING,
      durationMinutes: 360,
      price: 18500.0,
      bayCapacityRequired: 1,
      isActive: true,
    },
    {
      slug: "multi-stage-paint-correction",
      name: "Multi-Stage Paint Correction",
      description:
        "Compound cut and dual-action polish to eliminate up to 90% of swirl marks, light scratches, and oxidation.",
      category: ServiceKind.PAINT_CORRECTION,
      durationMinutes: 240,
      price: 8500.0,
      bayCapacityRequired: 1,
      isActive: true,
    },
    {
      slug: "full-interior-deep-clean",
      name: "Full Interior Deep Clean",
      description:
        "Steam extraction, leather conditioning, antimicrobial air sanitization, and detailed cockpit rejuvenation.",
      category: ServiceKind.INTERIOR_DETAILING,
      durationMinutes: 180,
      price: 4500.0,
      bayCapacityRequired: 1,
      isActive: true,
    },
    {
      slug: "premium-exterior-wash-seal",
      name: "Premium Exterior Wash & Seal",
      description:
        "Two-bucket pH-neutral wash, iron decontamination, clay bar treatment, and synthetic sealant spray finish.",
      category: ServiceKind.EXTERIOR_WASH_SEAL,
      durationMinutes: 90,
      price: 1800.0,
      bayCapacityRequired: 1,
      isActive: true,
    },
  ];

  console.log("Seeding services...");
  const createdServices: Record<string, string> = {};
  for (const svc of services) {
    const record = await prisma.service.upsert({
      where: { slug: svc.slug },
      update: {
        name: svc.name,
        description: svc.description,
        category: svc.category,
        durationMinutes: svc.durationMinutes,
        price: svc.price,
        bayCapacityRequired: svc.bayCapacityRequired,
        isActive: svc.isActive,
      },
      create: svc,
    });
    createdServices[svc.slug] = record.id;
  }

  // ---------------------------------------------------------------------------
  // 3. Schedule Configuration & Time Slots
  // ---------------------------------------------------------------------------
  console.log("Seeding schedule configuration...");
  const effectiveDate = new Date("2026-01-01T00:00:00.000Z");
  await prisma.scheduleConfig.upsert({
    where: { effectiveDate },
    update: {
      defaultSlotIntervalMinutes: 30,
      defaultBayCapacity: 2,
      openTime: "08:00",
      closeTime: "18:00",
    },
    create: {
      effectiveDate,
      defaultSlotIntervalMinutes: 30,
      defaultBayCapacity: 2,
      openTime: "08:00",
      closeTime: "18:00",
    },
  });

  console.log("Seeding weekly recurring time slots (Mon–Sun, 08:00–18:00, 30m intervals)...");
  // Days: 0 (Sunday) to 6 (Saturday). 7 days a week open.
  const timeIntervals: { start: string; end: string }[] = [];
  let currentHour = 8;
  let currentMinute = 0;

  while (currentHour < 18) {
    const startH = String(currentHour).padStart(2, "0");
    const startM = String(currentMinute).padStart(2, "0");

    let nextMinute = currentMinute + 30;
    let nextHour = currentHour;
    if (nextMinute >= 60) {
      nextMinute = 0;
      nextHour += 1;
    }

    const endH = String(nextHour).padStart(2, "0");
    const endM = String(nextMinute).padStart(2, "0");

    timeIntervals.push({
      start: `${startH}:${startM}`,
      end: `${endH}:${endM}`,
    });

    currentHour = nextHour;
    currentMinute = nextMinute;
  }

  for (let day = 0; day <= 6; day++) {
    for (const interval of timeIntervals) {
      await prisma.timeSlot.upsert({
        where: {
          dayOfWeek_startTime: {
            dayOfWeek: day,
            startTime: interval.start,
          },
        },
        update: {
          endTime: interval.end,
          maxVehicleCapacity: 2,
          isActive: true,
        },
        create: {
          dayOfWeek: day,
          startTime: interval.start,
          endTime: interval.end,
          maxVehicleCapacity: 2,
          isActive: true,
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Staff & Detailers
  // ---------------------------------------------------------------------------
  console.log("Seeding staff detailers & manager...");
  const staffMembers = [
    {
      name: "Marcus Reyes",
      phone: "+639171112233",
      email: "marcus.reyes@zeusdetailing.ph",
      role: StaffRole.DETAILER,
      defaultCommissionRate: 0.15,
      isActive: true,
    },
    {
      name: "Angelo Santos",
      phone: "+639172223344",
      email: "angelo.santos@zeusdetailing.ph",
      role: StaffRole.DETAILER,
      defaultCommissionRate: 0.12,
      isActive: true,
    },
    {
      name: "Dave Bautista",
      phone: "+639173334455",
      email: "dave.bautista@zeusdetailing.ph",
      role: StaffRole.MANAGER,
      defaultCommissionRate: 0.0,
      isActive: true,
    },
  ];

  for (const staff of staffMembers) {
    await prisma.staff.upsert({
      where: { email: staff.email },
      update: {
        name: staff.name,
        phone: staff.phone,
        role: staff.role,
        defaultCommissionRate: staff.defaultCommissionRate,
        isActive: staff.isActive,
      },
      create: staff,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Inventory Items & Bill of Materials (BOM)
  // ---------------------------------------------------------------------------
  console.log("Seeding inventory items...");
  const inventoryItems = [
    {
      sku: "COAT-9H-50ML",
      name: "Zeus Shield Pro 9H Ceramic Coating (50ml)",
      category: "Coating",
      unit: "bottle",
      currentStock: 25.0,
      reorderLevel: 5.0,
      costPerUnit: 3500.0,
    },
    {
      sku: "CHEM-CUT-500ML",
      name: "Heavy Cut Polishing Compound (500ml)",
      category: "Polishing",
      unit: "bottle",
      currentStock: 18.0,
      reorderLevel: 4.0,
      costPerUnit: 1250.0,
    },
    {
      sku: "CHEM-FIN-500ML",
      name: "Ultra Fine Finishing Polish (500ml)",
      category: "Polishing",
      unit: "bottle",
      currentStock: 15.0,
      reorderLevel: 4.0,
      costPerUnit: 1100.0,
    },
    {
      sku: "PAD-FOAM-5IN",
      name: "5-Inch Dual Action Foam Cutting/Polishing Pad",
      category: "Consumables",
      unit: "piece",
      currentStock: 40.0,
      reorderLevel: 10.0,
      costPerUnit: 450.0,
    },
    {
      sku: "APP-BLOCK-FOAM",
      name: "Ceramic Coating Foam Applicator Block & Suede Cloth",
      category: "Consumables",
      unit: "piece",
      currentStock: 60.0,
      reorderLevel: 15.0,
      costPerUnit: 120.0,
    },
    {
      sku: "TWL-MF-400GSM",
      name: "Edgeless Microfiber Buffing Towel (400 GSM)",
      category: "Consumables",
      unit: "piece",
      currentStock: 80.0,
      reorderLevel: 20.0,
      costPerUnit: 150.0,
    },
  ];

  const createdItems: Record<string, string> = {};
  for (const item of inventoryItems) {
    const record = await prisma.inventoryItem.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        category: item.category,
        unit: item.unit,
        currentStock: item.currentStock,
        reorderLevel: item.reorderLevel,
        costPerUnit: item.costPerUnit,
      },
      create: item,
    });
    createdItems[item.sku] = record.id;
  }

  // ---------------------------------------------------------------------------
  // 6. Service Recipes (BOM Links)
  // ---------------------------------------------------------------------------
  console.log("Seeding service recipes (BOM)...");
  const recipes = [
    {
      serviceSlug: "signature-ceramic-coating",
      itemSku: "COAT-9H-50ML",
      quantityRequired: 1.0,
    },
    {
      serviceSlug: "signature-ceramic-coating",
      itemSku: "APP-BLOCK-FOAM",
      quantityRequired: 1.0,
    },
    {
      serviceSlug: "signature-ceramic-coating",
      itemSku: "TWL-MF-400GSM",
      quantityRequired: 2.0,
    },
    {
      serviceSlug: "multi-stage-paint-correction",
      itemSku: "CHEM-CUT-500ML",
      quantityRequired: 0.25,
    },
    {
      serviceSlug: "multi-stage-paint-correction",
      itemSku: "PAD-FOAM-5IN",
      quantityRequired: 1.0,
    },
    {
      serviceSlug: "premium-exterior-wash-seal",
      itemSku: "TWL-MF-400GSM",
      quantityRequired: 1.0,
    },
  ];

  for (const recipe of recipes) {
    const serviceId = createdServices[recipe.serviceSlug];
    const inventoryItemId = createdItems[recipe.itemSku];
    if (serviceId && inventoryItemId) {
      await prisma.serviceRecipe.upsert({
        where: {
          serviceId_inventoryItemId: {
            serviceId,
            inventoryItemId,
          },
        },
        update: {
          quantityRequired: recipe.quantityRequired,
        },
        create: {
          serviceId,
          inventoryItemId,
          quantityRequired: recipe.quantityRequired,
        },
      });
    }
  }

  console.log("✅ Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
