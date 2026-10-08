import { createHash } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { normalizeRole, canAccessPage } from '@/lib/access-control'
import type { ReportRequest } from '@/lib/report-request'
import { createReportCache, createQueryGate, redisCommand } from './report-cache'

const cache = createReportCache()
const queryGate = createQueryGate()
export class ReportError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function readReport(request: ReportRequest) {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw new ReportError('Silakan login kembali.', 401)
  const { data: profile, error: profileError } = await client.from('profiles').select('role,is_active').eq('id', user.id).single()
  const role = normalizeRole(profile?.role)
  if (profileError || !profile?.is_active || !role) throw new ReportError('Akun tidak memiliki akses.', 403)
  if (request.rpc === 'printex_report_details' && !canAccessPage(role, '/reports')) throw new ReportError('Akun tidak memiliki akses laporan.', 403)
  // Never cache authorization. This also checks branch activation and membership.
  const { data: context, error: contextError } = await client.rpc('printex_branch_context').abortSignal(AbortSignal.timeout(10_000))
  if (contextError || !context) throw new ReportError('Akses cabang belum dapat diperiksa.', 503)
  const branches: string[] = context.branches.map((branch: { id: string }) => branch.id).sort()
  if (!branches.length && !context.central) throw new ReportError('Akun belum memiliki cabang aktif.', 403)
  if (request.args.p_branch && !branches.includes(request.args.p_branch)) throw new ReportError('Anda tidak memiliki akses ke cabang ini.', 403)
  const { p_start, p_end, p_branch } = request.args
  const args = request.rpc === 'printex_daily_report' ? { p_start, p_end, p_branch } : request.args
  const load = () => queryGate(async () => {
    const { data, error: rpcError } = await client.rpc(request.rpc, args).abortSignal(AbortSignal.timeout(25_000))
    if (rpcError) throw new ReportError('Laporan belum dapat dimuat. Coba kembali.', rpcError.code === '42501' ? 403 : 503)
    if (!data || typeof data !== 'object') throw new ReportError('Respons laporan tidak valid.', 503)
    return JSON.stringify(data)
  }, () => new ReportError('Laporan sedang sibuk. Coba kembali beberapa saat lagi.', 429))
  // Details and exports always query PostgreSQL, so personal order data stays out of Redis.
  if (request.rpc !== 'printex_daily_report') return { value: await load(), source: 'database' }
  const key = 'printex:report:v1:' + createHash('sha256').update(JSON.stringify([process.env.NEXT_PUBLIC_SUPABASE_URL, user.id, role, context.central, branches, args])).digest('hex')
  const complete = (value: string) => {
    try {
      const data = JSON.parse(value)
      const age = Date.now() - Date.parse(data.asOf)
      return Array.isArray(data.rows) && data.pending === false && age >= -5000 && age < 30_000
    }
    catch { return false }
  }
  let redisHit = false
  const result = await cache.read(key, async () => {
    if (!request.bypassCache) {
      const saved = await redisCommand(['GET', key])
      if (typeof saved === 'string' && complete(saved)) { redisHit = true; return saved }
    }
    const value = await load()
    if (complete(value) && Buffer.byteLength(value) <= 512 * 1024) await redisCommand(['SET', key, value, 'PX', '30000'])
    return value
  }, complete, request.bypassCache)
  return { ...result, source: result.source === 'database' && redisHit ? 'redis' : result.source }
}
