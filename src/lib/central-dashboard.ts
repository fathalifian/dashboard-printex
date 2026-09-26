import { dailyOutput } from './daily-output'
import { jakartaDate, type ProcessEvent } from './process-metrics'
import type { BoardOrder, Branch } from './production-board'

export function shiftDate(day: string, offset: number) {
  const date = new Date(day + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export function centralDashboard(orders: BoardOrder[], history: ProcessEvent[], branches: Branch[], start: string, end: string, now: Date) {
  const today = jakartaDate(now)
  const knownBranches = new Set(branches.map(branch => branch.id))
  const scoped = orders.filter(order => order.branch_id && knownBranches.has(order.branch_id))
  const byId = new Map(scoped.map(order => [order.id, order]))
  const branchName = new Map(branches.map(branch => [branch.id, branch.name]))
  const pending = scoped.filter(order => order.order_state !== 'completed' && order.order_state !== 'cancelled' && !order.archive?.finalizedAt)
  const overdue = pending.filter(order => order.due_at && order.due_at < today).sort((a,b) => a.due_at.localeCompare(b.due_at))
  const dueToday = pending.filter(order => order.due_at === today)
  const latestEntry = new Map<string, number>()
  for (const event of history) {
    const order = byId.get(event.orderId)
    const time = Date.parse(event.occurredAt)
    if (order && event.kind === 'entered' && event.stage === order.board_stage && Number.isFinite(time) && time <= now.getTime()) {
      latestEntry.set(order.id, Math.max(latestEntry.get(order.id) ?? 0, time))
    }
  }
  const longest = pending.flatMap(order => {
    const since = latestEntry.get(order.id) ?? (order.board_stage === 'incoming' ? Date.parse(order.created_at) : NaN)
    return Number.isFinite(since) && since <= now.getTime() ? [{order, milliseconds: now.getTime() - since}] : []
  }).sort((a,b) => b.milliseconds-a.milliseconds).slice(0,5)
  const output = dailyOutput(scoped, history, start, end)
  const rows = branches.map(branch => {
    const branchOrders = scoped.filter(order => order.branch_id === branch.id)
    return { ...branch, output: dailyOutput(branchOrders,history,start,end),
      pending: pending.filter(order => order.branch_id === branch.id).length,
      overdue: overdue.filter(order => order.branch_id === branch.id).length }
  }).sort((a,b) => b.overdue-a.overdue || a.name.localeCompare(b.name))
  const trend = Array.from({length:7},(_,i) => {
    const day = shiftDate(end,i-6)
    return {day,...dailyOutput(scoped,history,day,day)}
  })
  const labels: Partial<Record<string,string>> = {incoming:'Order masuk',printing:'Selesai print',done:'Selesai produksi'}
  const activity = history.flatMap(event => {
    const order = byId.get(event.orderId)
    const branch = order?.branch_id ?? event.branchId
    if (!branch || !knownBranches.has(branch) || !Number.isFinite(Date.parse(event.occurredAt))) return []
    const date = jakartaDate(event.occurredAt)
    if (date < start || date > end) return []
    if (!((event.stage === 'incoming' || event.stage === 'done') && event.kind === 'entered') && !(event.stage === 'printing' && event.kind === 'completed')) return []
    return [{ id:event.id, orderId:order?.id, spk:event.spkCode, label:labels[event.stage]!, at:event.occurredAt,
      branch:branchName.get(branch)!, actor:event.actorName }]
  })
  for (const order of scoped) {
    const at=order.archive?.finalizedAt
    if (!at || !Number.isFinite(Date.parse(at))) continue
    const date=jakartaDate(at)
    if (date>=start && date<=end) activity.push({id:'archive-'+order.id,orderId:order.id,spk:order.spk_code,label:'Diarsipkan',at,branch:branchName.get(order.branch_id!)!,actor:null})
  }
  activity.sort((a,b)=> Date.parse(b.at)-Date.parse(a.at) || a.id.localeCompare(b.id))
  return {today,output,rows,pending:pending.length,overdue,dueToday,longest,trend,activity:activity.slice(0,8)}
}
