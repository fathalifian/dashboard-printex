# Testing & Acceptance Criteria

## 1. Unit tests

Prioritas:

- status calculation
- overdue calculation
- phone normalization
- allowed transitions
- permission checks
- scheduling ordering
- due date formatting

## 2. Integration tests

- create order initializes steps
- advance step writes activity
- completed order moves to history query
- finance update cannot be performed by CS
- realtime event causes data refresh
- schedule generate persists items

## 3. E2E scenarios

### Scenario A — CS mencari order

1. Login sebagai CS.
2. Search `SPK-1092`.
3. Detail order muncul.
4. Current process terlihat.
5. Last activity terlihat.

**Expected:** informasi tersedia tanpa membuka page lain.

### Scenario B — Designer update

1. Designer membuka order tahap Design.
2. Mark design complete.
3. CS pada komputer lain melihat perubahan.

**Expected:** update realtime dan audit actor tercatat.

### Scenario C — produksi selesai

1. Production advance ke Selesai.
2. Order hilang dari active list.
3. Order muncul pada Riwayat.
4. Search tetap menemukan order.

### Scenario D — overdue

1. due_at melewati waktu sekarang.
2. Order belum completed.

**Expected:** badge/indicator Terlambat muncul otomatis.

### Scenario E — scheduler

Input:

```txt
A urgent 1,2
B normal 1,6
C normal 1,2
```

Expected baseline:

```txt
A lebih dulu; C dapat dikelompokkan dengan 1,2 jika due B aman.
```

## 4. UI acceptance criteria

- Search terlihat pada first viewport desktop.
- Status tidak hanya dibedakan warna.
- Table readable 1366×768.
- Tidak ada horizontal overflow pada main desktop selain table jika viewport sempit.
- Loading tidak membuat layout melompat drastis.

## 5. Performance targets

- Dashboard initial useful content: secepat mungkin pada jaringan kantor normal.
- Search response perceived < 500 ms.
- Status update reflected pada client lain idealnya < 2 detik.

## 6. UAT checklist

Libatkan minimal:

- 1 CS
- 1 Designer
- 1 Admin Keuangan
- 1 Production/Supervisor

Uji dengan data order nyata selama periode pilot sebelum menggantikan alur manual.
