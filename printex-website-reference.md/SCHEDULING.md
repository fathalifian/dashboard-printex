# Production Scheduling Specification

## 1. Tujuan

Menghasilkan **recommended production schedule** dari order aktif dengan mempertimbangkan:

1. due date
2. urgent priority
3. ukuran kertas/media
4. meter/workload
5. mesin yang tersedia
6. setup change

## 2. Prototype Figma saat ini

Algorithm prototype:

```txt
1. Exclude order selesai
2. Urgent first
3. Sort lebar: 1,2 → 1,6 → 1,8
4. Tampilkan separator saat lebar berubah
```

Ini cocok untuk prototype, tetapi belum cukup untuk production karena due date harus memiliki bobot kuat.

## 3. Recommended algorithm v1

Gunakan **Hybrid EDD + Family/Batch Scheduling**.

### Hard rules

- completed/cancelled tidak masuk scheduler
- blocked/on-hold tidak masuk kecuali override
- order yang due lebih awal tidak boleh terdorong terlalu jauh hanya demi menyamakan ukuran kertas

### Priority score

Contoh formula awal:

```txt
score =
  urgency_score
+ due_date_score
+ overdue_score
+ same_paper_bonus
- setup_change_penalty
```

Tetapi untuk implementasi awal lebih mudah dan transparan dengan rule sequence:

```pseudo
eligible = active + ready_for_production

1. overdue orders first, sorted by earliest due
2. urgent orders, sorted by earliest due
3. remaining orders grouped by due-date window
4. within a safe due-date window, prefer same paper width as current setup
5. tie-breaker: earlier order_date / FIFO
```

## 4. Safe due-date window

Contoh:

Jika dua order memiliki due date cukup jauh sehingga batching tidak menyebabkan keterlambatan, kelompokkan ukuran kertas.

```txt
A: 1,2 m due 14:00
B: 1,6 m due 17:00
C: 1,2 m due 16:30
```

Recommended:

```txt
A 1,2 → C 1,2 → setup → B 1,6
```

hanya jika B tetap diperkirakan selesai sebelum due.

## 5. Processing time

Jika kecepatan mesin tersedia:

```txt
processing_minutes = meter / speed_meter_per_hour * 60
```

Tambahkan:

```txt
planned_duration = processing_minutes + setup_minutes
```

## 6. Setup time

Setup matrix future:

| From | To | Setup |
|---|---|---:|
| 1,2 | 1,2 | 0 |
| 1,2 | 1,6 | configurable |
| 1,6 | 1,8 | configurable |

Jangan hard-code setup minute di frontend.

## 7. Scheduler output

Setiap item harus memiliki `reason` agar operator percaya pada rekomendasi:

- `Overdue — due 12:30`
- `Urgent + earliest due date`
- `Same paper width 1,2 m — reduce setup`
- `FIFO tie-breaker`

## 8. Manual override

Scheduler bukan mandatory sequence.

User berwenang dapat:

- drag & drop
- assign machine
- move to next day
- exclude order

Semua override dicatat.

## 9. Advanced versions

Setelah data aktual tersedia:

- OR-Tools CP-SAT
- weighted tardiness minimization
- sequence-dependent setup time
- multiple parallel machines
- machine eligibility constraints
- planned vs actual comparison

Jangan mulai dari advanced optimizer sebelum master data processing time cukup baik.
