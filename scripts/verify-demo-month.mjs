import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import {validateDemoMonth} from './lib/validate-demo-month.mjs'

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
  await db.exec(`INSERT INTO branches(name) VALUES('Demak'),('Surabaya'),('Gunung jati'),('Jombang'),('Kartasura'),('Kediri'),('Klaten'),('Pekalongan'),('Saladua'),('Solo');
    INSERT INTO auth.users(id,email) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','demo-test@example.test');
    UPDATE profiles SET role='central_owner',is_active=true WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';`)
  await db.exec('BEGIN');
  await db.exec(readFileSync('supabase/RESET_DEMO_MONTH.sql','utf8'));
  console.log(JSON.stringify(await validateDemoMonth(db)));
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,0);
  console.log('PASS: simulated month, dashboard calculations match SQL, reset rolls back atomically.');
} finally { await db.close() }
