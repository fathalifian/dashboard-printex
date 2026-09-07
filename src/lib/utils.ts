import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { endOfDay, format, isPast, isToday } from 'date-fns'
import { id } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return format(new Date(dateStr), 'd MMM yyyy', { locale: id })
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return format(new Date(dateStr), 'd MMM yyyy HH:mm', { locale: id })
}

export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return format(new Date(dateStr), 'HH:mm', { locale: id })
}

export function formatRelative(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return format(new Date(dateStr), 'd MMM yyyy, HH:mm', { locale: id })
}

export function isOverdue(dueAt: string | null | undefined, orderState: string): boolean {
  if (!dueAt) return false
  if (orderState === 'completed' || orderState === 'cancelled') return false
  return isPast(endOfDay(new Date(dueAt)))
}

export function formatDueDate(dueAt: string | null | undefined, orderState: string): string {
  if (!dueAt) return '-'
  const date = new Date(dueAt)
  if (isToday(date)) {
    return 'Hari ini'
  }
  if (isPast(endOfDay(date)) && orderState !== 'completed') {
    return `Terlambat · ${format(date, 'd MMM yyyy', { locale: id })}`
  }
  return format(date, 'd MMM yyyy', { locale: id })
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) return '62' + digits.slice(1)
  if (digits.startsWith('62')) return digits
  if (digits.startsWith('8')) return '62' + digits
  return digits
}

export function getStepColorClass(colorToken: string | null | undefined) {
  switch (colorToken) {
    case 'amber':
      return 'bg-amber-50 text-amber-700 border-amber-200'
    case 'violet':
      return 'bg-violet-50 text-violet-700 border-violet-200'
    case 'blue':
      return 'bg-blue-50 text-blue-700 border-blue-200'
    case 'emerald':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    case 'red':
      return 'bg-red-50 text-red-700 border-red-200'
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200'
  }
}
