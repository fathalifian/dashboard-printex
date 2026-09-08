-- Preserve existing stage IDs and historical events; no synthetic Press events.
BEGIN;
UPDATE public.production_steps SET name=CASE code
  WHEN 'ORDER_IN' THEN 'Order Masuk' WHEN 'DESIGN' THEN 'Proses Desain'
  WHEN 'DESIGN_DONE' THEN 'Menunggu Pembayaran' WHEN 'PRINTING' THEN 'Proses Sublim'
  WHEN 'DONE' THEN 'Order Selesai' WHEN 'ARCHIVE' THEN 'Order Diterima Customer' END,
  sequence=CASE code WHEN 'ORDER_IN' THEN 1 WHEN 'DESIGN' THEN 2
  WHEN 'DESIGN_DONE' THEN 3 WHEN 'PRINTING' THEN 4 WHEN 'DONE' THEN 6 WHEN 'ARCHIVE' THEN 7 END
WHERE code IN ('ORDER_IN','DESIGN','DESIGN_DONE','PRINTING','DONE','ARCHIVE');
INSERT INTO public.production_steps(code,name,sequence,color_token)
VALUES('PRESS','Proses Press',5,'violet')
ON CONFLICT(code) DO UPDATE SET name=excluded.name,sequence=excluded.sequence,color_token=excluded.color_token;

CREATE OR REPLACE FUNCTION public.enforce_adjacent_order_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_code text; next_code text; previous_position integer; next_position integer;
BEGIN
  IF OLD.current_step_id IS NOT DISTINCT FROM NEW.current_step_id THEN RETURN NEW; END IF;
  SELECT code,sequence INTO previous_code,previous_position FROM public.production_steps WHERE id=OLD.current_step_id;
  SELECT code,sequence INTO next_code,next_position FROM public.production_steps WHERE id=NEW.current_step_id;
  IF previous_code='ORDER_IN' AND next_code='DESIGN_DONE' THEN RETURN NEW; END IF;
  IF previous_code='PRINTING' AND next_code='DONE' AND NEW.production_type='DTF' THEN RETURN NEW; END IF;
  IF previous_position IS NULL OR next_position IS NULL OR abs(next_position-previous_position)<>1 THEN
    RAISE EXCEPTION 'Orders can only move to the previous or next stage, skip design, or skip Press for DTF';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_adjacent_order_stage() FROM PUBLIC;
COMMIT;
