// Customer view of a rejected booking submission (P1-09). For time conflicts the server may put the
// staff-entered BlockedDate.reason into message and fieldErrors, so those codes always render fixed
// wording and no server field text. Other codes keep their fixed server messages and field errors.
import type { ContractError } from "@/types/contracts";

export const SLOT_UNAVAILABLE_MESSAGE =
  "The selected arrival slot is no longer available. Please select another time session. Your customer and vehicle details have been saved.";

export interface PublicSubmitError {
  message: string;
  fieldErrors: Record<string, string[]>;
}

export function isTimeConflict(error: Pick<ContractError, "code">): boolean {
  return error.code === "SLOT_UNAVAILABLE" || error.code === "SCHEDULE_CONFLICT";
}

export function publicSubmitError(error: ContractError): PublicSubmitError {
  if (isTimeConflict(error)) return { message: SLOT_UNAVAILABLE_MESSAGE, fieldErrors: {} };
  return { message: error.message, fieldErrors: error.fieldErrors };
}
