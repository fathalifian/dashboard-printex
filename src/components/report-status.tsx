'use client'

export default function ReportStatus({report}:{report:{enabled:boolean;loading:boolean;error:string;retry:()=>unknown}}) {
  if(!report.enabled)return null
  if(report.error)return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{report.error}<button type="button" className="ml-3 font-semibold underline" onClick={()=>void report.retry()}>Coba kembali</button></div>
  return report.loading?<p role="status" className="p-4 text-sm text-slate-500">Memuat ringkasan...</p>:null
}
