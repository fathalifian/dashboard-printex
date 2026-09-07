# Deployment & Security

## 1. Deployment

Recommended:

```txt
GitHub
  ↓
Vercel
  ↓
Custom domain/subdomain
  ↓
Supabase PostgreSQL
```

Contoh domain:

```txt
monitoring.printex.id
production.printex.id
```

## 2. Environments

Minimum:

- development
- production

Lebih baik:

- development
- staging
- production

Gunakan Supabase project/database berbeda untuk production bila memungkinkan.

## 3. Authentication

Internal users wajib login.

- account per orang, bukan satu password bersama
- email/password atau enterprise method future
- disable account saat staf tidak lagi memiliki akses

## 4. Authorization

- role disimpan pada profile
- permission checked server-side
- RLS enabled

## 5. Data protection

Data customer seperti nomor telepon adalah data operasional internal.

Praktik minimum:

- HTTPS
- jangan expose service-role key
- mask/sembunyikan data sensitif dari role yang tidak memerlukan jika nanti scope meluas
- jangan log secret/token

## 6. Backup

- database backups sesuai kemampuan plan/provider
- export CSV berkala untuk operational fallback pada fase awal
- dokumentasikan restore procedure

## 7. Audit

Action penting tidak boleh tanpa actor:

- order create/update
- status transition
- cancel/hold
- invoice/payment
- schedule override

## 8. Availability fallback

Jika internet kantor putus, aplikasi cloud tidak dapat sinkron.

Untuk MVP:

- tampilkan connection/realtime status
- jangan berpura-pura update sukses jika server gagal

Offline-first penuh bukan requirement awal.

## 9. Deployment checklist

- [ ] env vars production
- [ ] RLS enabled/tested
- [ ] production user accounts
- [ ] domain configured
- [ ] HTTPS valid
- [ ] seed production steps
- [ ] initial roles
- [ ] test create/search/update
- [ ] test realtime 2 browser berbeda
- [ ] backup/export procedure
