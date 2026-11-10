# Dmails — Webmail & Mail Server

Webmail bergaya Gmail dengan desain profesional berwarna datar (tanpa gradien), lengkap dengan server SMTP
untuk menerima email dan pengiriman keluar lewat relay atau langsung ke server MX.

## Fitur

**Webmail**
- Kotak Masuk, Berbintang, Terkirim, Draf, Semua Email, Spam, dan Sampah
- Tampilan percakapan (thread) seperti Gmail, termasuk pesan yang diciutkan
- Tulis pesan di jendela mengambang (minimalkan / layar penuh), bisa beberapa jendela sekaligus
- Balas, Balas ke semua, dan Teruskan langsung di dalam percakapan
- Editor teks kaya (tebal, miring, daftar, kutipan, tautan), lampiran hingga 25 MB (bisa seret & lepas)
- Draf tersimpan otomatis, plus **Urungkan kirim** selama 5 detik
- Saran penerima otomatis dari pengguna server dan riwayat email
- Label berwarna, arsip, tandai spam, hapus, pulihkan, beserta tombol **Urungkan**
- Pencarian dengan operator: `from:`, `to:`, `subject:`, `has:attachment`, `is:unread`, `is:starred`, `in:trash`, `label:`
- Pembaruan real-time saat email masuk (Server-Sent Events)
- Pintasan keyboard: `c` tulis, `/` cari, `r`/`a`/`f` balas/balas semua/teruskan, `e` arsip, `#` hapus, `j`/`k` navigasi
- Setelan: nama pengirim, tanda tangan, kepadatan tampilan, label, ubah sandi
- Responsif: desktop, tablet (sidebar ringkas), dan mobile (drawer + tombol Tulis mengambang)

**Server**
- SMTP masuk (MX) dengan validasi penerima — alamat yang tidak ada ditolak `550`, relay terbuka ditolak
- Pengiriman antar-pengguna lokal instan; pengiriman ke domain luar lewat SMTP relay atau langsung ke MX (opsional DKIM)
- Pemberitahuan gagal kirim (bounce) masuk ke percakapan yang sama, seperti Gmail
- Isi HTML email disanitasi dan ditampilkan di iframe sandbox tanpa skrip
- Sandi di-hash dengan scrypt, sesi memakai cookie httpOnly, proteksi CSRF, pembatasan percobaan login
- Database SQLite tunggal (tanpa server database terpisah)

## Menjalankan

Prasyarat: **Node.js 22+**.

```bash
npm install
cp .env.example .env      # opsional, sesuaikan isinya
npm run dev               # webmail http://localhost:5173, API :3000, SMTP :2525
```

Mode produksi:

```bash
npm run build
npm start                 # webmail + API di http://localhost:3000
```

Saat database masih kosong dibuat data demo (matikan dengan `SEED_DEMO=false`):

| Akun                 | Sandi       |
| -------------------- | ----------- |
| `raka@dmails.local`  | `demo12345` |
| `budi@dmails.local`  | `demo12345` |
| `siti@dmails.local`  | `demo12345` |

Uji SMTP masuk secara lokal, misalnya dengan [swaks](https://www.jetmore.org/john/code/swaks/):

```bash
swaks --server localhost:2525 --to raka@dmails.local --from teman@contoh.id --header "Subject: Halo"
```

## Menjadikannya server email sungguhan

1. **Domain & DNS** (contoh domain `contoh.id`, server `mail.contoh.id`):
   - `A` &nbsp; `mail.contoh.id` → IP server
   - `MX` &nbsp; `contoh.id` → `mail.contoh.id` (prioritas 10)
   - `TXT` (SPF) &nbsp; `contoh.id` → `v=spf1 mx -all` (tambahkan `include:` penyedia relay bila memakai relay)
   - `TXT` (DMARC) &nbsp; `_dmarc.contoh.id` → `v=DMARC1; p=quarantine; rua=mailto:postmaster@contoh.id`
   - PTR/reverse DNS IP server → `mail.contoh.id` (diatur di penyedia VPS)
2. **`.env`**: `MAIL_DOMAIN=contoh.id`, `SMTP_HOSTNAME=mail.contoh.id`, `SEED_DEMO=false`, `COOKIE_SECURE=true`.
3. **Port 25**: jalankan dengan `SMTP_PORT=25` (butuh hak akses) atau teruskan port, mis.
   `iptables -t nat -A PREROUTING -p tcp --dport 25 -j REDIRECT --to-port 2525`.
4. **Pengiriman keluar**: banyak penyedia cloud memblokir port 25 keluar, jadi gunakan `OUTBOUND_MODE=relay`
   dengan kredensial penyedia SMTP. Untuk `direct`, aktifkan DKIM:
   ```bash
   openssl genrsa -out dkim.pem 2048
   openssl rsa -in dkim.pem -pubout -outform der | base64 -w0   # isi p= pada DNS
   ```
   DNS: `TXT` `mail._domainkey.contoh.id` → `v=DKIM1; k=rsa; p=<kunci publik>`, lalu
   `DKIM_SELECTOR=mail` dan `DKIM_PRIVATE_KEY_FILE=/path/dkim.pem`.
5. **HTTPS**: letakkan di belakang reverse proxy (Nginx/Caddy) yang meneruskan ke port 3000.
   Untuk Nginx, nonaktifkan buffering pada `/api/events` agar pembaruan real-time berjalan.
   Sertifikat yang sama dapat dipakai untuk STARTTLS lewat `SMTP_TLS_KEY` dan `SMTP_TLS_CERT`.
6. Cadangkan folder `data/` secara berkala (berisi database SQLite dan lampiran).

## Batasan saat ini

- Belum ada IMAP/POP3 dan SMTP submission (port 587), jadi akses email hanya lewat webmail ini.
- Pengiriman ke domain luar dicoba sekali; bila gagal, pengirim langsung menerima pemberitahuan gagal kirim (belum ada antrean ulang).
- Penyaringan spam hanya membaca header `X-Spam-Flag` (mis. dari SpamAssassin/Rspamd di depan server).

## Struktur proyek

```
server/            Backend Node.js (Express 5 + SQLite)
  index.ts         Titik masuk: HTTP + SMTP
  routes.ts        REST API
  auth.ts          Sandi, sesi, pembatasan login
  mail/            Kotak surat, percakapan, pengiriman, SMTP masuk
  seed.ts          Data demo
web/               Frontend React + Vite
  src/App.tsx      Header, sidebar, tata letak
  src/MailList.tsx Daftar percakapan
  src/ThreadView.tsx  Tampilan percakapan
  src/Composer.tsx Jendela tulis pesan
  src/Settings.tsx Setelan
  src/styles.css   Gaya dasar (warna datar)
```
