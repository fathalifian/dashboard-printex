interface StatCardProps {
  title: string
  value: number | string
  attention?: boolean
  description?: string
}

export default function StatCard({ title, value, attention, description }: StatCardProps) {
  return (
    <div className="stat-card border-b border-slate-200 px-4 py-5 sm:px-6">
      <p className="text-xs font-medium text-slate-500 sm:text-sm">{title}</p>
      <p className={`mt-3 text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl ${attention && Number(value) > 0 ? 'text-red-600' : 'text-slate-900'}`}>{value}</p>
      {description && <p className="mt-2 text-xs text-slate-500">{description}</p>}
    </div>
  )
}
