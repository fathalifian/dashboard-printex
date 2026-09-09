import { PROCESS_STAGES, type ProcessEvent, type ProcessStage } from './process-metrics'

export type TimedOrder = {
  id: string; created_at: string; board_stage: ProcessStage;
  archive: { archivedAt: string } | null
}
export const TIMED_STAGES = ['design','design_done','printing','press'] as const
export function orderTiming(order: TimedOrder, history: ProcessEvent[], now: number) {
  const events = history.filter(e=>e.orderId===order.id && Number.isFinite(Date.parse(e.occurredAt)))
    .sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt))
  const startedAt = events.find(e=>(e.stage==='design'||e.stage==='design_done')&&e.kind==='entered')?.occurredAt ?? null
  const completedAt = events.find(e=>e.stage==='done'&&e.kind==='entered')?.occurredAt ?? null
  const finished = !!completedAt || order.board_stage==='done' || order.board_stage==='archive'
  const end = completedAt ? Date.parse(completedAt) : finished ? Date.parse(events.at(-1)?.occurredAt??'') : now
  const startAt = startedAt ? Date.parse(startedAt) : NaN
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
    if(!Number.isFinite(startAt)||at<startAt)continue
    if(at>end)break
    for(const event of group.filter(e=>e.kind!=='entered')) {
      if((open as {stage:ProcessStage;at:number}|null)?.stage===event.stage)close(at)
    }
    for(const event of group.filter(e=>e.kind==='entered')) {
      if(!TIMED_STAGES.some(stage=>stage===event.stage)){close(at);continue}
      if((open as {stage:ProcessStage;at:number}|null)?.stage===event.stage)continue
      close(at)
      stages[event.stage].visited=true
      open={stage:event.stage,at}
    }
  }
  if(open) {
    const row=stages[open.stage]
    row.milliseconds+=Math.max(0,end-open.at)
    row.running=!finished && open.stage===order.board_stage
    if(completedAt)row.lastExit=completedAt
  }
  return { stages, totalMilliseconds:Number.isFinite(startAt)&&(!finished||completedAt)?Math.max(0,end-startAt):null, finished, startedAt, completedAt }
}

export function formatDuration(milliseconds:number|null) {
  if(milliseconds===null)return 'Belum tercatat'
  const seconds=Math.max(0,Math.floor(milliseconds/1000))
  const days=Math.floor(seconds/86400), hours=Math.floor(seconds%86400/3600), minutes=Math.floor(seconds%3600/60)
  return [days?`${days} hari`:'',hours?`${hours} jam`:'',minutes?`${minutes} mnt`:'',`${seconds%60} dtk`].filter(Boolean).join(' ')
}
