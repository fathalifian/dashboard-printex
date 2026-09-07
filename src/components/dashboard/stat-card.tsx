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
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <div className={cn('rounded-lg p-2', colors.bg)}>
          <Icon className={cn('h-5 w-5', colors.icon)} />
        </div>
      </div>
      <p className={cn('mt-3 text-3xl font-bold', colors.value)}>{value}</p>
      {description && (
        <p className="mt-1 text-xs text-slate-400">{description}</p>
      )}
    </div>
  )
}
