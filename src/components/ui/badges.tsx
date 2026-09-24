import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  stepCode: string
  stepName: string
  colorToken?: string | null
  isOverdue?: boolean
  size?: 'sm' | 'md'
}

export function StatusBadge(props: StatusBadgeProps) {
  const { stepName, isOverdue, size = 'md' } = props
  if (isOverdue) {
    return (
      <span className={cn(
        'inline-flex items-center gap-1 rounded-md border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        'bg-red-50 text-red-700 border-red-200'
      )}>
        <span>⚠</span>
        Terlambat
      </span>
    )
  }

  return (
    <span className={cn(
      'inline-flex items-center rounded-md border font-medium',
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
      'bg-slate-50 text-slate-700 border-slate-200'
    )}>
      {stepName}
    </span>
  )
}

interface CustomerTypeBadgeProps {
  customerType: string
  size?: 'sm' | 'md'
}

export function CustomerTypeBadge({ customerType, size = 'md' }: CustomerTypeBadgeProps) {
  if (customerType === 'priority') {
    return (
      <span className={cn(
        'inline-flex items-center gap-1 rounded-md border font-medium bg-brand-50 text-brand-700 border-brand-200',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
      )}>
        Customer Prioritas
      </span>
    )
  }
  return (
    <span className={cn(
      'inline-flex items-center rounded-md border font-medium bg-slate-50 text-slate-600 border-slate-200',
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
    )}>
      Customer Biasa
    </span>
  )
}
