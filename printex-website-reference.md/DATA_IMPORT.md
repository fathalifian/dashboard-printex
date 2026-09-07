# Data Import / CSV Integration

## 1. Tujuan

Website harus dapat menerima datalist order Printex yang sudah ada tanpa input ulang satu per satu.

## 2. Current CSV source fields

Data awal yang pernah digunakan memiliki pola kolom:

```txt
Kode Transaksi
Jenis
Tanggal
Estimasi Selesai
Nama Customer
Alamat Customer
Telp Customer
Judul
Sales
Status
```

## 3. Data tambahan untuk scheduling

Agar jadwal dapat dibuat dengan baik, tambahkan/derive:

```txt
Ukuran Kertas
Jumlah Meter
Priority
Mesin (jika diketahui)
Material/Bahan (future)
```

## 4. Import flow

```mermaid
flowchart LR
    F[Upload CSV] --> V[Validate & Preview]
    V --> M[Map Columns]
    M --> D[Detect Duplicate]
    D --> I[Import]
    I --> R[Import Result]
```

## 5. Duplicate key

Preferensi:

1. official SPK / transaction code
2. external transaction code
3. fallback composite key hanya jika terpaksa

Jangan duplicate hanya karena nama customer sama.

## 6. Preview screen

Sebelum import tampilkan:

- valid rows
- invalid rows
- duplicate rows
- mapped fields

User dapat mengunduh error list future, tetapi MVP cukup menampilkan tabel error.

## 7. Mapping example

| CSV | Database |
|---|---|
| Kode Transaksi | external_transaction_code / spk_code |
| Jenis | production_type |
| Tanggal | order_date |
| Estimasi Selesai | due_at |
| Nama Customer | customers.name |
| Telp Customer | customers.phone |
| Judul | notes / job_title |
| Status | imported source status mapping |

## 8. Normalization

### Phone

Normalize contoh:

```txt
0812 3456 7890 -> 6281234567890
+62 812-3456-7890 -> 6281234567890
```

Simpan display/original optional, gunakan normalized untuk search/dedup.

### Paper width

```txt
1,2 / 1.2 / 120 -> 1200 mm
1,6 / 1.6 / 160 -> 1600 mm
1,8 / 1.8 / 180 -> 1800 mm
```

## 9. Import audit

Buat `import_batches` future jika import rutin:

- filename
- imported_by
- imported_at
- total_rows
- success_rows
- failed_rows

Setiap order import memiliki `source = csv`.
