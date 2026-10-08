import { reportRequestSchema } from '@/lib/report-request'
import { readReport, ReportError } from '@/lib/server/report-service'

export const runtime = 'nodejs'
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Origin tidak diizinkan.' }, { status: 403, headers })
  try {
    const body = await request.text()
    if (body.length > 4096) return Response.json({ error: 'Permintaan terlalu besar.' }, { status: 413, headers })
    let input: unknown
    try { input = JSON.parse(body) } catch { return Response.json({ error: 'Permintaan tidak valid.' }, { status: 400, headers }) }
    const parsed = reportRequestSchema.safeParse(input)
    if (!parsed.success) return Response.json({ error: 'Filter laporan tidak valid.' }, { status: 400, headers })
    const started = performance.now()
    const result = await readReport(parsed.data)
    return new Response(result.value, { headers: { ...headers, 'Server-Timing': `report;dur=${(performance.now() - started).toFixed(1)}`, 'X-Report-Cache': result.source } })
  } catch (error) {
    const status = error instanceof ReportError ? error.status : 503
    return Response.json({ error: error instanceof ReportError ? error.message : 'Laporan belum dapat dimuat. Coba kembali.' }, { status, headers: status === 429 ? { ...headers, 'Retry-After': '10' } : headers })
  }
}
