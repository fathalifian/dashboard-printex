import { PROCESS_STAGES, type ProcessEvent, type ProcessStage } from './process-metrics'

export type TimedOrder = {
  id: string; created_at: string; board_stage: ProcessStage;
  archive: { archivedAt: string } | null
}
export function orderTiming(order: TimedOrder, history: ProcessEvent[], now: number) {
  const endAt = order.archive ? Date.parse(order.archive.archivedAt) : now
  const end = Number.isFinite(endAt) ? endAt : now
  const events = history.filter(e=>e.orderId===order.id && Number.isFinite(Date.parse(e.occurredAt)))
    .sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt))
  const start = events.find(e=>e.stage==='incoming'&&e.kind==='entered')?.occurredAt ?? order.created_at
  const startAt = Date.parse(start)
  const stages = Object.fromEntries(PROCESS_STAGES.map(stage=>[stage,{ milliseconds:0, visited:false, running:false, lastExit:null as string|null }])) as Record<ProcessStage,{milliseconds:number;visited:boolean;running:boolean;lastExit:string|null}>
  let open: {stage:ProcessStage;at:number}|null = null
  const close = (at:number) => {
    if(!open)return
    const row=stages[open.stage]
    row.milliseconds+=Math.max(0,Math.min(at,end)-open.at)
    row.lastExit=new Date(Math.min(at,end)).toISOString()
    open=null
  }
  // Raw transitions are required here: milestone deduplication would discard revisits.
  // Process exits at a timestamp are handled before entries at the same timestamp.
  const groups=new Map<number,ProcessEvent[]>()
  for(const event of events){const at=Date.parse(event.occurredAt);const group=groups.get(at)??[];group.push(event);groups.set(at,group)}
  for(const [at,group] of groups) {
    if(at>end)break
    for(const event of group.filter(e=>e.kind!=='entered')) {
      if((open as {stage:ProcessStage;at:number}|null)?.stage===event.stage)close(at)
    }
    for(const event of group.filter(e=>e.kind==='entered')) {
      if(event.stage==='archive'){close(at);continue}
      if((open as {stage:ProcessStage;at:number}|null)?.stage===event.stage)continue
      close(at)
      stages[event.stage].visited=true
      open={stage:event.stage,at}
    }
  }
  if(open) {
    const row=stages[open.stage]
    row.milliseconds+=Math.max(0,end-open.at)
    row.running=!order.archive && open.stage===order.board_stage
    if(order.archive)row.lastExit=new Date(end).toISOString()
  }
  return { stages, totalMilliseconds:Number.isFinite(startAt)?Math.max(0,end-startAt):null, finished:!!order.archive, receivedAt:order.archive?.archivedAt??null }
}

export function formatDuration(milliseconds:number|null) {
  if(milliseconds===null)return 'Belum tercatat'
  const seconds=Math.max(0,Math.floor(milliseconds/1000))
  const days=Math.floor(seconds/86400), hours=Math.floor(seconds%86400/3600), minutes=Math.floor(seconds%3600/60)
  return [days?`${days} hari`:'',hours?`${hours} jam`:'',minutes?`${minutes} mnt`:'',`${seconds%60} dtk`].filter(Boolean).join(' ')
}
