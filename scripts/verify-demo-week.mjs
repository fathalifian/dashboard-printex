import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const db = new PGlite()
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, deleted_at timestamptz, raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE PUBLICATION supabase_realtime;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,created_at timestamptz DEFAULT now(),UNIQUE(bucket_id,name));
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage TO authenticated,anon;
    GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
    GRANT SELECT ON storage.buckets TO authenticated;`)
  for (const folder of ['supabase/migrations', 'supabase/branch-migrations']) {
    for (const file of readdirSync(folder).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(`${folder}/${file}`, 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/, ''))
    }
  }
  await db.exec(`INSERT INTO branches(name) VALUES('Demak'),('Surabaya');
    INSERT INTO auth.users(id,email) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','demo-test@example.test');
    UPDATE profiles SET role='central_owner',is_active=true WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';`)
  const preserved = async () => (await db.query(`SELECT
    (SELECT jsonb_agg(p ORDER BY id) FROM profiles p) AS profiles,
    (SELECT jsonb_agg(b ORDER BY id) FROM branches b) AS branches,
    (SELECT jsonb_agg(u ORDER BY id) FROM auth.users u) AS users`)).rows
  const before = await preserved()
  const sql = readFileSync('supabase/RESET_DEMO_WEEK.sql', 'utf8')
  for (let run=0; run<2; run++) {
    const results = await db.exec(sql)
    assert.deepEqual(await preserved(), before)
    const report = results.at(-1).rows
    assert.equal(report.length, 4)
    assert.equal(report[0].cabang, 'Salatiga')
    assert.ok(report.slice(1).every(r => Number(r.total_order)<Number(report[0].total_order) && Number(r.output_meter)<Number(report[0].output_meter)))
    const { bad } = (await db.query(`SELECT count(*)::int AS bad FROM process_history h JOIN orders o ON o.id=h.order_id
      WHERE h.branch_id<>o.branch_id OR h.occurred_at<o.created_at OR h.occurred_at>now()`)).rows[0]
    assert.equal(bad, 0)
    assert.equal((await db.query(`SELECT count(DISTINCT order_date)::int AS n FROM orders`)).rows[0].n, 7)
    assert.equal((await db.query(`SELECT count(DISTINCT production_type)::int AS n FROM orders`)).rows[0].n, 5)
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM orders o JOIN production_steps s ON s.id=o.current_step_id
      WHERE o.production_type='DTF' AND (o.paper_width<>0.6 OR s.code='PRESS')`)).rows[0].n,0)
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='orders'::regclass AND tgenabled='D'`)).rows[0].n,0)
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM process_history h WHERE h.event_kind='completed'
      AND NOT EXISTS(SELECT 1 FROM process_history next WHERE next.order_id=h.order_id
        AND next.event_kind='entered' AND next.occurred_at=h.occurred_at AND next.step_id<>h.step_id)`)).rows[0].n,0)
    console.log(JSON.stringify({run:run+1,report}))
  }
  // Failure after destructive statements must roll back data and trigger state.
  const hashBefore=(await db.query(`SELECT md5(string_agg(id::text,',' ORDER BY id)) AS hash FROM orders`)).rows[0].hash
  const broken=sql.replace("SELECT setseed(0.29473);", "SELECT 1/0;")
  await assert.rejects(()=>db.exec(broken),/division by zero/)
  await db.exec('ROLLBACK')
  assert.equal((await db.query(`SELECT md5(string_agg(id::text,',' ORDER BY id)) AS hash FROM orders`)).rows[0].hash,hashBefore)
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='orders'::regclass AND tgenabled='D'`)).rows[0].n,0)
  console.log('PASS: reset twice, archives removed, accounts/branches preserved, chronological branch histories, seven days, Salatiga leads.')
} finally { await db.close() }
