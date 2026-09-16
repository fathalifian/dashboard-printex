import { cn } from '@/lib/utils'
import { type LucideIcon } from 'lucide-react'

interface StatCardProps {
  title: string
  value: number | string
  icon: LucideIcon
  color?: 'blue' | 'amber' | 'emerald' | 'red' | 'violet'
  description?: string
}

const colorMap = {
  blue: {
    bg: 'bg-blue-50',
    icon: 'text-blue-600',
    value: 'text-blue-700',
  },
  amber: {
    bg: 'bg-amber-50',
    icon: 'text-amber-600',
    value: 'text-amber-700',
  },
  emerald: {
    bg: 'bg-emerald-50',
    icon: 'text-emerald-600',
    value: 'text-emerald-700',
  },
  red: {
    bg: 'bg-red-50',
    icon: 'text-red-600',
    value: 'text-red-600',
  },
  violet: {
    bg: 'bg-violet-50',
    icon: 'text-violet-600',
    value: 'text-violet-700',
  },
}

export default function StatCard({ title, value, icon: Icon, color = 'blue', description }: StatCardProps) {
  const colors = colorMap[color]
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-h-10 text-sm font-medium text-slate-500 sm:min-h-5">{title}</p>
        <div className={cn('shrink-0 rounded-lg p-2', colors.bg)}>
          <Icon aria-hidden="true" className={cn('h-[18px] w-[18px]', colors.icon)} strokeWidth={1.8} />
        </div>
      </div>
      <p className={cn('mt-3 text-3xl font-semibold tracking-tight tabular-nums', colors.value)}>{value}</p>
      {description && (
        <p className="mt-1 text-xs text-slate-400">{description}</p>
      )}
    </div>
  )
}
