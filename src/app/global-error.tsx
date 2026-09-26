'use client'

import ErrorRecovery from '@/components/error-recovery'

export default function GlobalError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="id"><body style={{ fontFamily: 'system-ui', padding: 24 }}><ErrorRecovery {...props} /></body></html>
}
