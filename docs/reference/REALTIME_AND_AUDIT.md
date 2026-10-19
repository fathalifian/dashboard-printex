# Realtime & Audit Trail

## 1. Realtime requirement

Kelima komputer harus melihat perubahan tanpa refresh manual.

Contoh:

1. Designer menandai Design selesai.
2. Database berubah.
3. Event realtime dikirim.
4. Dashboard CS memperbarui row/detail otomatis.

## 2. Supabase Realtime channels

Subscribe minimal pada:

- `orders`
- `order_step_events`
- `order_activities`
- `production_schedules`
- `schedule_items`
- `invoices` bila finance summary tampil lintas role

## 3. UI behavior

Saat menerima update:

- invalidate/refetch query terkait
- jangan overwrite form yang sedang diedit tanpa warning
- tampilkan toast ringan untuk perubahan penting

Contoh:

`SPK-1092 diperbarui ke Printing & Press oleh Operator Produksi`

## 4. Activity log

Activity log bersifat append-only dari sisi UI.

Event type minimum:

```txt
ORDER_CREATED
ORDER_UPDATED
STEP_STARTED
STEP_COMPLETED
STEP_BLOCKED
ORDER_COMPLETED
ORDER_HELD
ORDER_CANCELLED
SCHEDULE_GENERATED
SCHEDULE_OVERRIDDEN
INVOICE_CREATED
PAYMENT_RECORDED
```

## 5. Metadata

Contoh:

```json
{
  "fromStep": "DESIGN",
  "toStep": "PRODUCTION",
  "previousDueAt": null,
  "newDueAt": null
}
```

## 6. Audit fields

Selalu simpan:

- actor_id
- timestamp
- event_type
- affected entity
- before/after untuk perubahan sensitif bila perlu

## 7. Conflict handling

Jika dua user mengedit data yang sama:

- gunakan `updated_at` / optimistic concurrency
- tampilkan warning jika version stale
- status transition harus atomic server-side
