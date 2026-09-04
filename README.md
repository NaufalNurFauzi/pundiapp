# Pundi — Money Management Planner

Versi lokal (VS Code / Vite) dari aplikasi Pundi yang tadinya berupa artifact React di Claude.ai.

## Cara Menjalankan

1. Buka folder ini di VS Code.
2. Buka terminal (Terminal → New Terminal), lalu jalankan:

   ```bash
   npm install
   npm run dev
   ```

3. Buka browser ke alamat yang muncul di terminal, biasanya `http://localhost:5173`.
   (`npm run dev` juga otomatis membuka tab browser baru.)

Untuk build versi production (menghasilkan folder `dist/` statis yang bisa di-hosting):

```bash
npm run build
npm run preview   # untuk mencoba hasil build-nya secara lokal
```

## Struktur Proyek

```
pundi-app/
├── index.html          # HTML entry point Vite
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.jsx         # entry point React, memuat polyfill storage sebelum App
    ├── App.jsx          # seluruh logika & UI aplikasi Pundi
    ├── index.css        # import Tailwind
    └── lib/
        └── storage.js   # polyfill window.storage → localStorage
```

## Supabase

Aplikasi sekarang memakai Supabase Auth dan PostgreSQL untuk akun, profil, serta
transaksi.

1. Buat project di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, lalu jalankan isi [`supabase/schema.sql`](./supabase/schema.sql).
3. Salin `.env.example` menjadi `.env.local`.
4. Isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` dari **Project Settings →
   API**. Gunakan key `anon`/publishable, bukan `service_role`.
5. Jalankan `npm run dev`.

Jika **Confirm email** aktif, pengguna harus memverifikasi email sebelum bisa
masuk. Atur URL redirect di Supabase **Authentication → URL Configuration** ke
URL aplikasi (misalnya `http://localhost:5173`).

## ⚠️ Penyimpanan Lokal

Versi asli Pundi (di Claude.ai) memakai `window.storage`, sebuah API bawaan
Claude.ai yang datanya tersimpan di server dan bisa diakses dari perangkat lain
dengan login yang sama ("shared storage").

Preferensi tema masih disimpan melalui `src/lib/storage.js` di **`localStorage`
browser**. Data akun dan transaksi tidak lagi disimpan di sana:

- Tema hanya tersimpan di browser/device ini.
- Akun dan transaksi tersinkron antar perangkat melalui Supabase.
- Jika localStorage dibersihkan, hanya preferensi tema yang hilang.
- Fitur "Backup JSON" & "Impor Data" di halaman Pengaturan jadi cara utama untuk
  memindahkan data antar device/browser — export dari satu tempat, import di tempat lain.

## Catatan Teknis Lain

- **Income bulanan bersifat manual, tidak auto-lanjut.** Aplikasi tidak otomatis
  memakai income bulan lalu untuk bulan baru. Begitu kalender masuk bulan baru,
  dashboard tetap menampilkan data ("saldo", alokasi, dsb.) dari bulan terakhir
  yang income-nya sudah dikonfirmasi manual, sampai user klik "Input Income
  Bulan Ini" dan mengisi nominalnya sendiri. Ini disengaja — supaya tidak ada
  angka yang "diam-diam" berubah tanpa sepengetahuan user.
- Password dikelola dan di-hash oleh Supabase Auth; aplikasi tidak menyimpan
  password.
- Ikon pakai [lucide-react](https://lucide.dev/).
- Styling pakai Tailwind (utility classes) + CSS custom (variabel warna, animasi)
  yang didefinisikan langsung di dalam `App.jsx`.
