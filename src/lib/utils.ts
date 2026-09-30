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
