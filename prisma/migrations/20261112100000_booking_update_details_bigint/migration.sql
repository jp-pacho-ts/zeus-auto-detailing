-- Allow admin_booking_update_details to accept bigint for p_expected_revision
CREATE OR REPLACE FUNCTION admin_booking_update_details(
  p_actor text,
  p_booking_id text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_vehicle_model text,
  p_vehicle_plate text,
  p_notes text,
  p_expected_revision bigint
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT admin_booking_update_details(
    p_actor,
    p_booking_id,
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_vehicle_model,
    p_vehicle_plate,
    p_notes,
    p_expected_revision::integer
  );
$$;

REVOKE ALL ON FUNCTION admin_booking_update_details(text, text, text, text, text, text, text, text, bigint) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_booking_update_details(text, text, text, text, text, text, text, text, bigint) TO zeus_app;
  END IF;
END $$;
