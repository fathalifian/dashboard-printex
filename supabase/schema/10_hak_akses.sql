-- Status database untuk aplikasi dan seluruh hak akses di satu tempat.
-- Prinsip: anon tidak mendapat apa pun; karyawan (authenticated) hanya membaca tabel yang dibutuhkan,
-- mengubah beberapa kolom pengaturan lewat RLS, dan menulis data lain hanya lewat fungsi RPC.

-- Aplikasi menolak bekerja bila schema_version berbeda dari ACCESS_SCHEMA_VERSION (src/lib/access-control.ts).
CREATE FUNCTION public.printex_online_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.printex_staff() THEN RAISE EXCEPTION 'Akun belum aktif. Hubungi admin.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('schema_version',9,'daily_summaries_enabled',true,'production_capacity_enabled',true,
    'realtime_tables',(SELECT jsonb_agg(tablename) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'));
END $$;

-- Mulai dari nol (Supabase memberi hak penuh bawaan pada objek baru di skema public).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Baca: dibatasi lagi oleh RLS (karyawan aktif; profil hanya milik sendiri kecuali Owner/Admin).
GRANT SELECT ON public.profiles, public.production_steps, public.production_machines, public.production_settings,
  public.customers, public.orders, public.process_history, public.operator_shifts, public.print_runs,
  public.stock_shortcuts, public.customer_service_settings TO authenticated;

-- Ubah langsung (hanya Owner/Admin lewat RLS, hanya kolom ini).
GRANT INSERT (kind,name), UPDATE (name,removed_at) ON public.production_machines TO authenticated;
GRANT UPDATE (shifts,shift_hours,planned_downtime_minutes,operators_printing,operators_dtf,operators_press,
  operators_design,design_orders_per_hour,version) ON public.production_settings TO authenticated;
GRANT UPDATE (label,url,version) ON public.stock_shortcuts TO authenticated;
GRANT UPDATE (whatsapp_number) ON public.customer_service_settings TO authenticated;

-- RPC aplikasi. Setiap fungsi memeriksa sendiri peran pemanggil.
GRANT EXECUTE ON FUNCTION
  public.printex_staff(), public.printex_admin(), public.printex_online_status(),
  public.printex_list_users(), public.printex_manage_user(uuid,text,text,boolean,boolean),
  public.printex_mutate_order(text,uuid,bigint,jsonb), public.printex_set_print_machine(uuid,bigint,uuid,boolean),
  public.printex_scoped_snapshot(date,date,uuid,jsonb,uuid,boolean,text[]), public.printex_sync_changes(bigint),
  public.printex_set_order_photo(uuid,bigint,text), public.printex_claim_photo_cleanup(text), public.printex_photo_deletable(text),
  public.printex_daily_report(date,date), public.printex_report_details(date,date,text,text,integer,integer,text),
  public.printex_set_operator_shift(date,text,integer,numeric), public.printex_start_run(uuid), public.printex_finish_run(uuid),
  public.printex_efficiency_inputs(date,date), public.printex_machine_productivity(date,date)
TO authenticated;

NOTIFY pgrst, 'reload schema';
