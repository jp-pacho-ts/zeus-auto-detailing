import "server-only";
import type { AdminDayBoard } from "@/types/admin-contracts";
import { DayQueuesQuerySchema } from "@/lib/admin-validation";
import { withStaffDb } from "@/server/auth/db-admission";
import {
  authorize,
  parse,
  type AdminOptions,
  type StaffActor,
} from "./context";

// One SQL statement: every nested aggregate observes the same READ COMMITTED snapshot.
export async function getDayBoard(
  actor: StaffActor,
  input: unknown,
  options: AdminOptions = {},
): Promise<AdminDayBoard> {
  authorize(actor, "READ");
  const { date } = parse(DayQueuesQuerySchema, input);
  return withStaffDb(
    "STAFF_READ",
    async (tx) => {
      const [row] = await tx.$queryRawUnsafe<{ board: AdminDayBoard }[]>(
        `WITH cards AS (
        SELECT b.id,b."queueCode",o."bayId",b."bookingDate",b."queuePosition",jsonb_build_object(
          'id',b.id,'referenceCode',b."referenceCode",'revision',b.revision,'bookingDate',b."bookingDate"::text,
          'queueCode',b."queueCode",'queuePosition',b."queuePosition",'vehicleModel',b."vehicleModel",'vehiclePlate',b."vehiclePlate",
          'sizeCode',b."vehicleSizeCodeSnapshot",'status',b.status,'assignedBayId',o."bayId",
          'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l."nameSnapshot",'workStatus',l."workStatus") ORDER BY l."order") FROM booking_line_items l WHERE l."bookingId"=b.id AND l."removedAt" IS NULL),'[]'),
          'assignedWorkers',COALESCE((SELECT jsonb_agg(jsonb_build_object('staffId',s.id,'name',s.name,'isActive',s."isActive") ORDER BY s.name,s.id) FROM booking_worker_assignments w JOIN staff s ON s.id=w."staffId" WHERE w."bookingId"=b.id),'[]'),
          'progress',(SELECT jsonb_build_object('done',count(*) FILTER(WHERE l."workStatus"='DONE'),'total',count(*)) FROM booking_line_items l WHERE l."bookingId"=b.id AND l."removedAt" IS NULL)) AS card
        FROM bookings b LEFT JOIN bay_occupancies o ON o."bookingId"=b.id
        WHERE b."snapshotVersion"='QUEUE_V3' AND b.status IN ('PENDING','CONFIRMED','IN_PROGRESS') AND (b."bookingDate"<=$1::date OR o."bayId" IS NOT NULL)
      ) SELECT jsonb_build_object('date',$1::text,
        'closed',(SELECT jsonb_build_object('reason',d.reason) FROM blocked_dates d WHERE d.date=$1::date AND d."isFullDay" LIMIT 1),
        'workers',COALESCE((SELECT jsonb_agg(jsonb_build_object('staffId',id,'name',name,'isActive',"isActive") ORDER BY name,id) FROM staff WHERE "isActive"),'[]'),
        'queues',(SELECT jsonb_agg(jsonb_build_object('code',q.code,'name',q.name,'bayType',m."bayType",'waiting',COALESCE((SELECT jsonb_agg(c.card ORDER BY c."bookingDate",c."queuePosition",c.id) FROM cards c WHERE c."queueCode"=q.code AND c."bayId" IS NULL),'[]')) ORDER BY q."sortOrder",q.code) FROM booking_queues q JOIN bay_type_queues m ON m."queueCode"=q.code),
        'bays',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',y.id,'name',y.name,'bayType',y."bayType",'sortOrder',y."sortOrder",'isActive',y."isActive",'updatedAt',to_char(y."updatedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'cards',COALESCE((SELECT jsonb_agg(c.card ORDER BY c."bookingDate",c."queuePosition",c.id) FROM cards c WHERE c."bayId"=y.id),'[]')) ORDER BY y."sortOrder",y.id) FROM bays y WHERE y."isActive" OR EXISTS(SELECT 1 FROM bay_occupancies o WHERE o."bayId"=y.id)),'[]')) AS board`,
        date,
      );
      return row.board;
    },
    { access: "read", db: options.db, signal: options.signal },
  );
}
