# Figma Make Handoff

## 1. Source analyzed

Primary source:

```txt
src/App.tsx
```

Prototype helper/older source also exists:

```txt
src/imports/pasted_text/order-dashboard.tsx
```

Gunakan `src/App.tsx` sebagai visual baseline utama.

## 2. Current components in prototype

| Prototype component | Production component suggestion |
|---|---|
| `Sidebar` | `components/layout/sidebar.tsx` |
| `StatCard` | `components/dashboard/stat-card.tsx` |
| `OrdersTable` | `components/orders/orders-table.tsx` |
| `OrderDetail` | `components/orders/order-detail.tsx` |
| `ProductionTimeline` | `components/tracking/production-timeline.tsx` |
| `AddOrderModal` | `components/orders/order-form-dialog.tsx` |
| `Badge` | `components/ui/status-badge.tsx` |
| `PriorityBadge` | `components/ui/priority-badge.tsx` |

## 3. Prototype logic that must NOT remain hard-coded

### FLOW

Current:

```ts
const FLOW = ["Order Masuk", "Design", "Printing & Press", "Selesai"];
```

Production:

```txt
load from production_steps ordered by sequence
```

### Initial orders

Current: hard-coded array.

Production: database query.

### Scheduler

Current:

```txt
Urgent first → width 1,2 → 1,6 → 1,8
```

Production: server-side scheduling module + persisted schedule.

### Current time labels

Current stores strings like:

```txt
Hari ini 17:00
Terlambat 1 jam
```

Production stores only timestamps; UI derives relative labels.

## 4. Current UI pages

Implemented conceptually:

- Dashboard
- Semua Order
- Tambah Order
- Tracking
- Jadwal Produksi
- Riwayat
- Pengaturan

Production addition:

- Keuangan
- Login

## 5. Current form fields

From Figma:

```txt
Nama Customer
Nomor WhatsApp
Jenis Produksi: Sublim / DTF / Press
Ukuran Kertas: 1,2 / 1,6 / 1,8 m
Jumlah Meter
Priority: Normal / Urgent
Tanggal Order
Due Date
Catatan
```

Pertahankan urutan dan visual field kecuali UAT menemukan masalah.

## 6. Preserve visual qualities

- `#F4F6F9` app background
- fixed white sidebar
- 64px header
- Inter
- slate neutrals
- blue primary
- subtle border/shadow
- compact data tables
- order status badges
- monospaced SPK code

## 7. Recommended conversion strategy

Jangan copy `App.tsx` utuh ke production.

Langkah:

1. Pecah layout dan UI components.
2. Buat TypeScript domain types dari database.
3. Ganti local state order dengan server query.
4. Implement auth + role guard.
5. Implement mutation server-side.
6. Tambahkan realtime.
7. Pindahkan scheduling logic server-side.
8. Tambahkan finance page.
