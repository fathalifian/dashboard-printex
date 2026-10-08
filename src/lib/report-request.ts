import { z } from 'zod'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + 'T00:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Tanggal tidak valid')

export const reportRequestSchema = z.object({
  rpc: z.enum(['printex_daily_report', 'printex_report_details']),
  bypassCache: z.boolean().default(false),
  args: z.object({
    p_start: date,
    p_end: date,
    p_branch: z.string().uuid().nullable().default(null),
    p_metric: z.enum(['archive', 'process', 'timing', 'production']).optional(),
    p_dimension: z.string().max(64).default(''),
    p_offset: z.number().int().min(0).max(10_000_000).default(0),
    p_limit: z.number().int().min(1).max(200).default(50),
    p_search: z.string().trim().max(200).default(''),
  }).strict(),
}).strict().superRefine(({ rpc, args }, context) => {
  const days = (Date.parse(args.p_end) - Date.parse(args.p_start)) / 86400000
  if (days < 0 || days > 365) context.addIssue({ code: 'custom', message: 'Rentang laporan maksimal 366 hari.', path: ['args', 'p_end'] })
  if (rpc === 'printex_report_details' && !args.p_metric) context.addIssue({ code: 'custom', message: 'Jenis laporan diperlukan.', path: ['args', 'p_metric'] })
})

export type ReportRequest = z.infer<typeof reportRequestSchema>
