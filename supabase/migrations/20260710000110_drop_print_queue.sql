-- S62: purge print_queue (décision internet-first 2026-07-06). Unique écrivain
-- = mesh LAN mort (purgé S62) ; le vrai print passe par le bridge externe en POST direct.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.print_queue) THEN
    RAISE EXCEPTION 'print_queue is not empty — abort drop, investigate first';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.enqueue_print_job_v1(uuid, jsonb, text, text, uuid, integer);
DROP FUNCTION IF EXISTS public.claim_print_job_v1(uuid);
DROP FUNCTION IF EXISTS public.mark_print_done_v1(uuid);
DROP FUNCTION IF EXISTS public.mark_print_failed_v1(uuid, text);
DROP FUNCTION IF EXISTS public.cancel_print_job_v1(uuid);
DROP TABLE IF EXISTS public.print_queue;
DELETE FROM public.permissions WHERE code IN ('print_queue.read', 'print_queue.manage');
