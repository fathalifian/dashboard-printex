import { printCompletions } from './daily-output'
import { jakartaDate, type ProcessEvent } from './process-metrics'
import type { BoardOrder, Branch } from './production-board'

export function shiftDate(day: string, offset: number) {
  const date = new Date(day + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export function centralDashboard(orders: BoardOrder[], history: ProcessEvent[], branches: Branch[], start: string, end: string, now: Date) {
  const summary = centralDashboardSummary(orders, history, branches, start, end, jakartaDate(now))
  return {...summary, longest: longestPendingOrders(summary.pendingOrders, history, now)}
}

export function longestPendingOrders(pending: BoardOrder[], history: ProcessEvent[], now: Date) {
  const byId = new Map(pending.map(order => [order.id, order]))
  const latestEntry = new Map<string, number>()
  for (const event of history) {
    const order = byId.get(event.orderId)
    const time = Date.parse(event.occurredAt)
    if (order && event.kind === 'entered' && event.stage === order.board_stage && Number.isFinite(time) && time <= now.getTime()) {
      latestEntry.set(order.id, Math.max(latestEntry.get(order.id) ?? 0, time))
    }
  }
  return pending.flatMap(order => {
    const since = latestEntry.get(order.id) ?? (order.board_stage === 'incoming' ? Date.parse(order.created_at) : NaN)
    return Number.isFinite(since) && since <= now.getTime() ? [{order, milliseconds: now.getTime() - since}] : []
  }).sort((a,b) => b.milliseconds-a.milliseconds).slice(0,5)
 }

export function centralDashboardSummary(orders: BoardOrder[], history: ProcessEvent[], branches: Branch[], start: string, end: string, today: string) {
  const knownBranches = new Set(branches.map(branch => branch.id))
  const scoped = orders.filter(order => order.branch_id && knownBranches.has(order.branch_id))
  const byId = new Map(scoped.map(order => [order.id, order]))
  const branchName = new Map(branches.map(branch => [branch.id, branch.name]))
  const pending = scoped.filter(order => order.order_date >= start && order.order_date <= end && order.order_state !== 'completed' && order.order_state !== 'cancelled' && !order.archive?.finalizedAt)
  const overdue = pending.filter(order => order.due_at && order.due_at < today).sort((a,b) => a.due_at.localeCompare(b.due_at))
  const dueToday = pending.filter(order => order.due_at >= start && order.due_at <= end)
  const completions = printCompletions(history)
  const emptyOutput = () => ({dtf:{meter:0,count:0},sublim:{meter:0,count:0}})
  const output = emptyOutput()
  const branchOutput = new Map(branches.map(branch => [branch.id, emptyOutput()]))
  const dailyOutput = new Map<string, ReturnType<typeof emptyOutput>>()
  for (const event of completions) {
    if (event.date < start || event.date > end) continue
    const order = byId.get(event.orderId)
    if (!order) continue
    const kind = order.production_type.trim().toUpperCase() === 'DTF' ? 'dtf' : 'sublim'
    const meter = Number.isFinite(order.meter) && order.meter > 0 ? order.meter : 0
    let daily = dailyOutput.get(event.date)
    if (!daily) { daily = emptyOutput(); dailyOutput.set(event.date, daily) }
    for (const totals of [output, branchOutput.get(order.branch_id!)!, daily]) {
      totals[kind].count++; totals[kind].meter += meter
    }
  }
  const rows = branches.map(branch => {
    const branchOrders = scoped.filter(order => order.branch_id === branch.id)
    return { ...branch, output: branchOutput.get(branch.id)!,
      completed: branchOrders.filter(order => order.order_date >= start && order.order_date <= end && order.order_state !== 'cancelled' && (order.order_state === 'completed' || Boolean(order.archive?.finalizedAt))).length,
      pending: pending.filter(order => order.branch_id === branch.id).length,
      overdue: overdue.filter(order => order.branch_id === branch.id).length }
  }).sort((a,b) => b.overdue-a.overdue || a.name.localeCompare(b.name))
  const days = Math.max(0,Math.round((Date.parse(end)-Date.parse(start))/86400000)+1)
  const trend = Array.from({length:days},(_,i) => {
    const day = shiftDate(start,i)
    return {day,...(dailyOutput.get(day) ?? emptyOutput())}
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
  return {today,output,rows,pending:pending.length,overdue,dueToday,pendingOrders:pending,trend,activity:activity.slice(0,8)}
}


// Live operational counts use active orders only; historical output and completed
// intake counts are provided separately by persisted daily summaries.
export function centralDashboardLiveSummary(orders:BoardOrder[],branches:Branch[],start:string,end:string,today:string) {
  const allowed=new Set(branches.map(branch=>branch.id))
  const pendingOrders=orders.filter(order=>order.branch_id&&allowed.has(order.branch_id)&&order.order_date>=start&&order.order_date<=end&&order.order_state!=='completed'&&order.order_state!=='cancelled'&&!order.archive?.finalizedAt)
  const overdue=pendingOrders.filter(order=>order.due_at&&order.due_at<today).sort((a,b)=>a.due_at.localeCompare(b.due_at))
  const dueToday=pendingOrders.filter(order=>order.due_at>=start&&order.due_at<=end)
  const emptyOutput=()=>({dtf:{meter:0,count:0},sublim:{meter:0,count:0}})
  const rows=branches.map(branch=>({...branch,output:emptyOutput(),completed:0,pending:pendingOrders.filter(order=>order.branch_id===branch.id).length,overdue:overdue.filter(order=>order.branch_id===branch.id).length})).sort((a,b)=>b.overdue-a.overdue||a.name.localeCompare(b.name))
  return {today,output:emptyOutput(),rows,pending:pendingOrders.length,overdue,dueToday,pendingOrders,trend:[] as ReturnType<typeof centralDashboardSummary>['trend'],activity:[] as ReturnType<typeof centralDashboardSummary>['activity']}
}
