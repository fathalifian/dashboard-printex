import {readFileSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {validateDemoMonth} from './lib/validate-demo-month.mjs'
const {Client,types}=createRequire(new URL('../.env.reset-tools/package.json',import.meta.url))('pg')
types.setTypeParser(1082,value=>value)
const db=new Client({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:15000,ssl:{rejectUnauthorized:true,ca:readFileSync('.env.reset-tools/supabase-ca.crt','utf8')}})
try{await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const report=await validateDemoMonth(db);await db.query('COMMIT');writeFileSync('build/demo-month-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))}catch(e){console.error(JSON.stringify({code:e.code??'VALIDATION_FAILED',message:e.message}));process.exitCode=1}finally{await db.end()}
