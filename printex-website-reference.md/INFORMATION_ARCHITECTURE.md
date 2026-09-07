# Information Architecture

## Sitemap

```mermaid
flowchart TD
    L[Login] --> D[Dashboard]
    D --> O[Semua Order]
    D --> T[Tracking Order]
    D --> S[Jadwal Produksi]
    D --> H[Riwayat]
    D --> F[Keuangan]
    D --> G[Pengaturan]
    O --> N[Tambah Order]
    O --> OD[Detail Order]
    T --> OD
    H --> OD
    S --> SD[Schedule Detail]
```

## Route recommendation

```txt
/login
/dashboard
/orders
/orders/new
/orders/[id]
/tracking
/schedule
/history
/finance
/settings
```

Optional future routes:

```txt
/customers
/machines
/reports
/integrations/whatsapp
```

## Navigation rules

- Semua role dapat membuka Dashboard dan Tracking.
- Menu/action yang tidak diizinkan harus disembunyikan atau disabled berdasarkan permission.
- Direct URL tetap dilindungi server-side authorization.

## Data ownership

Tidak ada “database CS”, “database designer”, atau “database keuangan” terpisah.

Semua role membaca sumber data yang sama:

```mermaid
flowchart LR
    CS[CS PC] --> DB[(Central Database)]
    DS[Designer PC] --> DB
    FN[Finance PC] --> DB
    PR[Production PC] --> DB
```
