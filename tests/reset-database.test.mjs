import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const reset = readFileSync('supabase/manual/1_RESET_STRUKTUR_DATABASE.sql', 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/, '')
const backup = readFileSync('supabase/reset/backup.sql', 'utf8')
async function supabase() {
  const db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
  CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, deleted_at timestamptz, raw_user_meta_data jsonb DEFAULT '{}', raw_app_meta_data jsonb DEFAULT '{}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO authenticated,anon; CREATE PUBLICATION supabase_realtime; CREATE SCHEMA storage;
  CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,created_at timestamptz DEFAULT now(),UNIQUE(bucket_id,name));
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated,anon;
  GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated; GRANT SELECT ON storage.buckets TO authenticated;`)
  return db
}
const rows = async (db, sql) => (await db.query(sql)).rows
const owner = '00000000-0000-4000-8000-0000000000a1', operator = '00000000-0000-4000-8000-0000000000a2'

test('reset builds an empty project and keeps accounts, settings and machines while removing orders', async () => {
  const db = await supabase()
  await db.exec(reset)
  assert.equal((await rows(db, "SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND column_name='branch_id'"))[0].n, 0)
  assert.equal((await rows(db, "SELECT to_regnamespace('printex_keep') s"))[0].s, null, 'The temporary backup is removed')
  // Accounts and settings made after the first build survive a second reset.
  await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'rowi@x.test'),($2,'op@x.test')`, [owner, operator])
  await db.query(`UPDATE profiles SET role='owner',is_active=true,full_name='Pak Rowi' WHERE id=$1`, [owner])
  await db.query(`UPDATE profiles SET role='operator',is_active=true WHERE id=$1`, [operator])
  await db.exec(`UPDATE production_settings SET shift_hours=8.5, operators_press=4;
   UPDATE production_machines SET name='Fedar Besar' WHERE name='Fedar 1';
   UPDATE stock_shortcuts SET url='' WHERE id='fabric';
   UPDATE customer_service_settings SET whatsapp_number='6281234567890';
   SET printex.importing='yes';
   INSERT INTO customers(id,name) VALUES('11111111-0000-4000-8000-000000000001','Customer');
   INSERT INTO orders(id,spk_code,customer_id,production_type,meter,current_step_id,order_date)
    VALUES('11111111-0000-4000-8000-000000000002','SPK-1','11111111-0000-4000-8000-000000000001','DTF',1,(SELECT id FROM production_steps WHERE code='ORDER_IN'),'2026-10-01');
   RESET printex.importing;`)
  await db.exec(reset)
  await db.exec(reset)
  assert.deepEqual(await rows(db, 'SELECT p.full_name,p.role,p.is_active FROM profiles p ORDER BY role'),
    [{ full_name: 'op@x.test', role: 'operator', is_active: true }, { full_name: 'Pak Rowi', role: 'owner', is_active: true }])
  assert.deepEqual(await rows(db, 'SELECT shift_hours::float h,effective_hours::float e,operators_press p FROM production_settings'), [{ h: 8.5, e: 6.5, p: 4 }])
  assert.equal((await rows(db, "SELECT string_agg(name,', ' ORDER BY name) m FROM production_machines"))[0].m, 'DTF 1, Fedar 2, Fedar Besar, Press 1')
  assert.equal((await rows(db, "SELECT url FROM stock_shortcuts WHERE id='fabric'"))[0].url, '')
  assert.equal((await rows(db, 'SELECT whatsapp_number FROM customer_service_settings'))[0].whatsapp_number, '6281234567890')
  assert.equal((await rows(db, 'SELECT count(*)::int n FROM orders'))[0].n, 0)
  assert.equal((await rows(db, 'SELECT count(*)::int n FROM auth.users'))[0].n, 2, 'Logins are kept')
})

test('an interrupted reset resumes from its saved backup', async () => {
  const db = await supabase()
  await db.exec(reset)
  await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'rowi@x.test')`, [owner])
  await db.query(`UPDATE profiles SET role='owner',is_active=true,full_name='Pak Rowi' WHERE id=$1`, [owner])
  await db.exec(`UPDATE production_settings SET operators_press=5`)
  await db.exec(backup) // stopped after part 1: public is empty, the backup remains
  assert.equal((await rows(db, "SELECT to_regclass('public.profiles') t"))[0].t, null)
  await db.exec(reset)
  assert.equal((await rows(db, "SELECT role FROM profiles WHERE id='" + owner + "'"))[0].role, 'owner')
  assert.equal((await rows(db, 'SELECT operators_press FROM production_settings'))[0].operators_press, 5)
})

test('without an active Owner the reset changes nothing', async () => {
  const db = await supabase()
  await db.exec(reset)
  await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'op@x.test')`, [operator])
  await db.query(`UPDATE profiles SET role='operator',is_active=true WHERE id=$1`, [operator])
  await assert.rejects(db.exec(reset), /Tidak ada akun Owner aktif/)
  await db.exec('ROLLBACK').catch(() => {})
  assert.equal((await rows(db, "SELECT to_regclass('public.production_settings') t"))[0].t, 'production_settings')
  assert.equal((await rows(db, "SELECT to_regnamespace('printex_keep') s"))[0].s, null)
})
