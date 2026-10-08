export async function requestReport<T>(rpc: string, args: Record<string, unknown>, bypassCache = false): Promise<T> {
  const response = await fetch('/api/reports', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rpc, args, bypassCache }),
    signal: AbortSignal.timeout(30_000),
  })
  // Session expiry can cause middleware to redirect to the login HTML page.
  if (response.redirected) throw new Error('Sesi login telah berakhir. Silakan login kembali.')
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Laporan belum dapat dimuat. Coba kembali.')
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Laporan belum dapat dimuat. Coba kembali.')
  return data as T
}
