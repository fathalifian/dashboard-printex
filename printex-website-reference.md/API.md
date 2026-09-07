# API Contract

Target implementasi: Next.js Route Handlers / Server Actions. URL di bawah adalah contract logis.

## General

Response sukses:

```json
{ "data": {}, "error": null }
```

Error:

```json
{
  "data": null,
  "error": {
    "code": "ORDER_NOT_FOUND",
    "message": "Order tidak ditemukan"
  }
}
```

## Orders

### GET `/api/orders`

Query:

```txt
q=
status=
step=
priority=
production_type=
paper_width=
due_from=
due_to=
page=
limit=
```

Search field:

- SPK
- customer name
- normalized phone

### POST `/api/orders`

```json
{
  "customer": {
    "name": "Nanang Sport",
    "phone": "081804203889"
  },
  "productionType": "sublim",
  "paperWidthMm": 1200,
  "meter": 38,
  "orderDate": "2026-09-03",
  "dueAt": "2026-09-03T17:00:00+07:00",
  "priority": "normal",
  "notes": "Warna merah dominan"
}
```

### GET `/api/orders/:id`

Return:

- order
- customer
- current step
- all step events
- activities
- invoice/payment summary

### PATCH `/api/orders/:id`

Update metadata; must write audit activity.

### POST `/api/orders/:id/advance`

```json
{
  "targetStepCode": "PRODUCTION",
  "note": "Design sudah approved"
}
```

Server validates permission and allowed transition.

### POST `/api/orders/:id/hold`

```json
{ "reason": "Menunggu konfirmasi customer" }
```

### POST `/api/orders/:id/cancel`

Requires supervisor permission or configured rule.

## Activities

### GET `/api/orders/:id/activities`

Sorted newest first.

## Schedule

### POST `/api/schedules/generate`

```json
{
  "date": "2026-09-03",
  "machineId": null,
  "includeOrderIds": null
}
```

Return:

```json
{
  "data": {
    "scheduleId": "uuid",
    "status": "draft",
    "items": [
      {
        "sequence": 1,
        "orderId": "uuid",
        "spk": "SPK-1093",
        "paperWidthMm": 1200,
        "reason": "Urgent + due date terdekat"
      }
    ]
  }
}
```

### PATCH `/api/schedules/:id/items/reorder`

Manual drag/drop sequence.

### POST `/api/schedules/:id/approve`

Supervisor/authorized production.

## Finance

### GET `/api/finance/orders`

### POST `/api/orders/:id/invoice`

### POST `/api/orders/:id/payments`

### PATCH `/api/invoices/:id`

## Master data

### GET `/api/production-steps`
### GET `/api/machines`
### GET `/api/users`

## Validation rules

- `meter >= 0`
- paper width allowed master values
- due_at must be valid datetime
- phone normalized before search/store
- SPK unique
- production transitions server-validated
- financial updates role-protected
