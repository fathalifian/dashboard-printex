import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'

test('scheduled cleanup preserves linked/recent photos, claims eligible files, retries and restricts access',async()=>{
 const db=new PGlite()
 try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
 CREATE SCHEMA storage; CREATE SCHEMA vault; CREATE SCHEMA net;
 CREATE TABLE public.orders(id uuid PRIMARY KEY,branch_id uuid,photo_path text);
 CREATE TABLE public.order_photo_cleanup(path text PRIMARY KEY,branch_id uuid,claimed boolean DEFAULT false,queued_at timestamptz DEFAULT now());
 CREATE TABLE storage.objects(bucket_id text,name text,created_at timestamptz DEFAULT now());
 CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
 INSERT INTO vault.decrypted_secrets VALUES('printex_storage_url','https://example.supabase.co'),('printex_storage_cleanup_key','test-only');
 CREATE TABLE net.requests(id bigint GENERATED ALWAYS AS IDENTITY,url text,headers jsonb);
 CREATE FUNCTION net.http_delete(url text,headers jsonb,timeout_milliseconds int) RETURNS bigint LANGUAGE sql AS $$
 INSERT INTO net.requests(url,headers) VALUES(url,headers) RETURNING id $$;`)
 await db.exec(readFileSync('supabase/jobs/photo-cleanup.sql','utf8'))
 await db.exec(`INSERT INTO storage.objects VALUES
 ('order-photos','linked',now()-interval '2 days'),
 ('order-photos','fresh',now()),
 ('order-photos','old',now()-interval '25 hours'),
 ('order-photos','folder/queued #.png',now()),
 ('different-bucket','unrelated',now()-interval '2 days');
 INSERT INTO orders VALUES(gen_random_uuid(),gen_random_uuid(),'linked');
 INSERT INTO order_photo_cleanup(path) VALUES('folder/queued #.png'),('linked');`)
 const run=async()=> (await db.query('SELECT public.printex_run_photo_cleanup() AS n')).rows[0].n
 assert.equal(await run(),2)
 const requests=(await db.query('SELECT url FROM net.requests ORDER BY id')).rows.map(r=>r.url)
 assert.ok(requests.some(url=>url.endsWith('folder/queued%20%23.png')))
 assert.ok(requests.some(url=>url.endsWith('/old')))
 assert.equal((await db.query('SELECT claimed FROM order_photo_cleanup WHERE path=$1',['linked'])).rows[0].claimed,false)
 assert.equal(await run(),0)
 // A failed HTTP response leaves the object in Storage: retry after the cooldown.
 await db.exec("UPDATE photo_cleanup_requests SET requested_at=now()-interval '5 minutes'")
 assert.equal(await run(),2)
 assert.equal((await db.query('SELECT count(*)::int AS n FROM storage.objects')).rows[0].n,5)
 await db.exec('SET ROLE authenticated')
 await assert.rejects(()=>run(),/permission denied/)
 await assert.rejects(()=>db.query('SELECT * FROM photo_cleanup_requests'),/permission denied/)
 } finally {await db.close()}
})
