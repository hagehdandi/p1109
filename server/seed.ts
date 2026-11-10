import { hashPassword } from './auth';
import { config } from './config';
import { db } from './db';
import { htmlToText } from './mail/format';
import { type Addr, type Folder, addAttachment, insertMessage, newMessageId, newThreadId, refreshHasAttachments } from './mail/mailbox';

const H = 3600_000;
const D = 24 * H;

type Seed = {
  userId: number;
  thread?: string;
  folder: Folder;
  from: Addr;
  to: Addr[];
  subject: string;
  html: string;
  ago: number;
  read?: boolean;
  starred?: boolean;
  labels?: number[];
  messageId?: string;
  inReplyTo?: string;
  files?: { filename: string; contentType: string; content: string }[];
};

const p = (...lines: string[]) => lines.map((l) => (l ? `<p>${l}</p>` : '')).join('');

/** Isi contoh untuk instalasi baru agar tampilan langsung bisa dicoba. Nonaktifkan dengan SEED_DEMO=false. */
export function seedDemoData(): void {
  if (!config.seedDemo) return;
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (n > 0) return;

  const now = Date.now();
  const mkUser = (local: string, name: string, color: string, signature = ''): Addr & { id: number } => {
    const address = `${local}@${config.domain}`;
    const info = db
      .prepare('INSERT INTO users (email, name, password_hash, color, signature, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(address, name, hashPassword('demo12345'), color, signature, now - 60 * D);
    return { id: Number(info.lastInsertRowid), name, address };
  };
  const raka = mkUser('raka', 'Raka Pratama', '#1a73e8', 'Raka Pratama\nProduct Manager · Dmails\n+62 812 3456 7890');
  const budi = mkUser('budi', 'Budi Santoso', '#188038');
  const siti = mkUser('siti', 'Siti Rahmawati', '#9334e6');
  const me: Addr = { name: raka.name, address: raka.address };

  const label = (name: string, color: string) =>
    Number(db.prepare('INSERT INTO labels (user_id, name, color) VALUES (?, ?, ?)').run(raka.id, name, color).lastInsertRowid);
  const work = label('Pekerjaan', '#1a73e8');
  const personal = label('Pribadi', '#188038');
  const finance = label('Keuangan', '#e37400');
  const travel = label('Perjalanan', '#9334e6');

  const put = (s: Seed) => {
    const id = insertMessage({
      userId: s.userId,
      threadId: s.thread ?? newThreadId(),
      folder: s.folder,
      messageId: s.messageId ?? newMessageId(),
      inReplyTo: s.inReplyTo ?? null,
      refs: s.inReplyTo ? [s.inReplyTo] : [],
      from: s.from,
      to: s.to,
      subject: s.subject,
      html: s.html,
      text: htmlToText(s.html),
      isRead: s.read ?? true,
      isStarred: s.starred,
      date: now - s.ago,
    });
    for (const l of s.labels ?? []) db.prepare('INSERT INTO message_labels (message_id, label_id) VALUES (?, ?)').run(id, l);
    for (const f of s.files ?? []) addAttachment(s.userId, id, { filename: f.filename, contentType: f.contentType, data: Buffer.from(f.content) });
    if (s.files?.length) refreshHasAttachments(id);
    return id;
  };

  // Percakapan internal Budi ↔ Raka (tersimpan di kedua kotak surat).
  const t1raka = newThreadId();
  const t1budi = newThreadId();
  const m1 = newMessageId();
  const m2 = newMessageId();
  const m3 = newMessageId();
  const subject1 = 'Rapat koordinasi proyek hari Senin';
  const body1 = p(
    'Halo Raka,',
    'Saya ingin mengajak rapat koordinasi proyek Dmails hari Senin pukul 10.00 di ruang rapat lantai 3. Agenda kita:',
    '1. Progres fitur webmail<br>2. Uji coba server SMTP<br>3. Rencana peluncuran',
    'Mohon konfirmasi kehadirannya, ya.',
    'Salam,<br>Budi',
  );
  const body2 = p('Siap, Budi. Saya hadir.', 'Saya akan siapkan demo antarmuka kotak masuk terbaru untuk rapat nanti.', 'Raka');
  const body3 = p(
    'Terima kasih, Raka.',
    'Saya lampirkan notulen rapat sebelumnya sebagai bahan diskusi. Sampai jumpa hari Senin!',
    'Budi',
  );
  const notes = {
    filename: 'notulen-rapat-oktober.txt',
    contentType: 'text/plain',
    content: 'Notulen Rapat Proyek Dmails\n\n- Fitur kotak masuk selesai 90%\n- Server SMTP siap diuji\n- Target peluncuran: Desember 2026\n',
  };
  const budiAddr: Addr = { name: budi.name, address: budi.address };
  put({ userId: raka.id, thread: t1raka, folder: 'inbox', from: budiAddr, to: [me], subject: subject1, html: body1, ago: 26 * H, labels: [work], messageId: m1 });
  put({ userId: raka.id, thread: t1raka, folder: 'sent', from: me, to: [budiAddr], subject: `Re: ${subject1}`, html: body2, ago: 25 * H, messageId: m2, inReplyTo: m1 });
  put({ userId: raka.id, thread: t1raka, folder: 'inbox', from: budiAddr, to: [me], subject: `Re: ${subject1}`, html: body3, ago: 1.5 * H, read: false, labels: [work], messageId: m3, inReplyTo: m2, files: [notes] });
  put({ userId: budi.id, thread: t1budi, folder: 'sent', from: budiAddr, to: [me], subject: subject1, html: body1, ago: 26 * H, messageId: m1 });
  put({ userId: budi.id, thread: t1budi, folder: 'inbox', from: me, to: [budiAddr], subject: `Re: ${subject1}`, html: body2, ago: 25 * H, messageId: m2, inReplyTo: m1 });
  put({ userId: budi.id, thread: t1budi, folder: 'sent', from: budiAddr, to: [me], subject: `Re: ${subject1}`, html: body3, ago: 1.5 * H, messageId: m3, inReplyTo: m2, files: [notes] });

  put({
    userId: raka.id,
    folder: 'inbox',
    from: { name: 'Keamanan Dmails', address: `keamanan@${config.domain}` },
    to: [me],
    subject: 'Peringatan keamanan: login baru di Chrome (Windows)',
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;border:1px solid #dadce0;border-radius:8px;padding:24px">
<div style="font-size:20px;color:#1f1f1f;margin-bottom:12px">Login baru ke akun Anda</div>
<p style="color:#3c4043;line-height:22px">Kami mendeteksi login baru ke akun <b>${raka.address}</b> dari perangkat Windows (Chrome) di Jakarta, Indonesia.</p>
<p style="color:#3c4043;line-height:22px">Jika ini Anda, tidak perlu melakukan apa pun. Jika bukan, segera ubah sandi akun Anda.</p>
<a href="#" style="display:inline-block;background:#0b57d0;color:#ffffff;text-decoration:none;padding:10px 24px;border-radius:20px;font-weight:bold">Periksa aktivitas</a></div>`,
    ago: 3 * H,
    read: false,
  });

  put({
    userId: raka.id,
    folder: 'inbox',
    from: { name: 'Sarah Wijaya', address: 'sarah@kreatifstudio.id' },
    to: [me],
    subject: 'Revisi desain landing page v2',
    html: p(
      'Hai Raka,',
      'Berikut revisi desain landing page sesuai masukan minggu lalu: warna aksen kini lebih netral, ilustrasi diganti ikon datar, dan tombol utama dibuat lebih menonjol.',
      'Rincian anggaran desain saya lampirkan dalam format CSV. Kabari saya kalau ada yang perlu disesuaikan.',
      'Terima kasih,<br>Sarah Wijaya<br>Kreatif Studio',
    ),
    ago: 20 * H,
    starred: true,
    labels: [work],
    files: [
      {
        filename: 'anggaran-desain.csv',
        contentType: 'text/csv',
        content: 'Item,Biaya (Rp)\nRiset pengguna,4500000\nDesain UI,12000000\nPrototipe,3500000\nTotal,20000000\n',
      },
    ],
  });

  put({
    userId: raka.id,
    folder: 'inbox',
    from: { name: 'Bank Nusantara', address: 'notifikasi@banknusantara.co.id' },
    to: [me],
    subject: 'e-Statement Oktober 2026 Anda telah tersedia',
    html: `<div style="font-family:Arial,sans-serif;max-width:560px">
<div style="background:#003d79;color:#fff;padding:16px 24px;font-size:18px;font-weight:bold">Bank Nusantara</div>
<div style="padding:24px;border:1px solid #e0e3e7;border-top:0">
<p style="line-height:22px">Yth. Bapak Raka Pratama,</p>
<p style="line-height:22px">e-Statement rekening Anda untuk periode <b>Oktober 2026</b> telah tersedia. Silakan masuk ke aplikasi mobile banking untuk melihat detail transaksi.</p>
<table style="border-collapse:collapse;margin:16px 0;font-size:14px"><tr><td style="padding:6px 24px 6px 0;color:#5f6368">Saldo akhir</td><td style="padding:6px 0"><b>Rp 18.450.000</b></td></tr>
<tr><td style="padding:6px 24px 6px 0;color:#5f6368">Total transaksi</td><td style="padding:6px 0">42 transaksi</td></tr></table>
<p style="color:#5f6368;font-size:12px">Email ini dikirim otomatis, mohon tidak membalas.</p></div></div>`,
    ago: 2 * D,
    labels: [finance],
  });

  put({
    userId: raka.id,
    folder: 'inbox',
    from: { name: 'Kabar Teknologi', address: 'redaksi@kabarteknologi.id' },
    to: [me],
    subject: '5 tren AI yang mengubah cara kita bekerja di 2026',
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1f1f1f">
<div style="font-size:24px;font-weight:bold;margin-bottom:8px">Kabar Teknologi Mingguan</div>
<div style="color:#5f6368;margin-bottom:20px">Edisi #128 · Ringkasan teknologi pilihan redaksi</div>
<div style="border-left:4px solid #0b57d0;padding:4px 16px;margin-bottom:16px"><b>1. Asisten AI di setiap aplikasi kantor</b><br>Dari email hingga spreadsheet, AI kini membantu menyusun draf dan merangkum dokumen.</div>
<div style="border-left:4px solid #188038;padding:4px 16px;margin-bottom:16px"><b>2. Otomatisasi alur kerja tanpa kode</b><br>Tim non-teknis membangun otomasi sendiri dalam hitungan menit.</div>
<div style="border-left:4px solid #e37400;padding:4px 16px;margin-bottom:16px"><b>3. Keamanan berbasis perilaku</b><br>Deteksi login mencurigakan memanfaatkan pola penggunaan pengguna.</div>
<p><a href="https://example.com">Baca selengkapnya di situs kami →</a></p></div>`,
    ago: 3 * D,
    read: false,
  });

  const sitiAddr: Addr = { name: siti.name, address: siti.address };
  const invite = newMessageId();
  const inviteHtml = p(
    'Halo semua,',
    'Untuk merayakan rilis beta Dmails, yuk makan siang bersama hari Jumat pukul 12.00 di Warung Nusantara (dekat kantor).',
    'Mohon balas email ini paling lambat Kamis supaya saya bisa reservasi tempat. 🍜',
    'Salam hangat,<br>Siti',
  );
  put({ userId: raka.id, folder: 'inbox', from: sitiAddr, to: [me, budiAddr], subject: 'Undangan makan siang tim hari Jumat', html: inviteHtml, ago: 4 * D, labels: [personal], messageId: invite });
  put({ userId: budi.id, folder: 'inbox', from: sitiAddr, to: [me, budiAddr], subject: 'Undangan makan siang tim hari Jumat', html: inviteHtml, ago: 4 * D, read: false, messageId: invite });
  put({ userId: siti.id, folder: 'sent', from: sitiAddr, to: [me, budiAddr], subject: 'Undangan makan siang tim hari Jumat', html: inviteHtml, ago: 4 * D, messageId: invite });

  put({
    userId: raka.id,
    folder: 'inbox',
    from: { name: 'HRD PT Maju Jaya', address: 'rekrutmen@majujaya.co.id' },
    to: [me],
    subject: 'Konfirmasi jadwal wawancara',
    html: p(
      'Yth. Bapak Raka Pratama,',
      'Terima kasih atas lamaran Anda. Kami mengundang Anda untuk wawancara pada <b>Rabu, 19 November 2026 pukul 14.00 WIB</b> secara daring melalui tautan yang akan kami kirimkan.',
      'Mohon konfirmasi kesediaan Anda dengan membalas email ini.',
      'Hormat kami,<br>Tim Rekrutmen PT Maju Jaya',
    ),
    ago: 6 * D,
    starred: true,
  });

  put({
    userId: raka.id,
    folder: 'inbox',
    from: { name: 'Nusa Travel', address: 'tiket@nusatravel.id' },
    to: [me],
    subject: 'E-tiket Anda: Jakarta (CGK) – Yogyakarta (YIA), 22 Nov 2026',
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;border:1px solid #dadce0;border-radius:8px;overflow:hidden">
<div style="background:#f1f3f4;padding:16px 24px;font-weight:bold">Kode booking: NT8K2Q</div>
<div style="padding:24px"><table style="width:100%;border-collapse:collapse;font-size:14px">
<tr><td style="color:#5f6368;padding:4px 0">Berangkat</td><td style="text-align:right"><b>Sab, 22 Nov 2026 · 07.15</b></td></tr>
<tr><td style="color:#5f6368;padding:4px 0">Rute</td><td style="text-align:right">CGK → YIA</td></tr>
<tr><td style="color:#5f6368;padding:4px 0">Penumpang</td><td style="text-align:right">Raka Pratama</td></tr></table>
<p style="color:#5f6368;font-size:12px;margin-top:16px">Harap tiba di bandara 90 menit sebelum keberangkatan.</p></div></div>`,
    ago: 7 * D,
    labels: [travel],
  });

  put({
    userId: raka.id,
    folder: 'inbox',
    from: { name: 'Tim Dmails', address: `halo@${config.domain}` },
    to: [me],
    subject: 'Selamat datang di Dmails, Raka!',
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1f1f1f">
<div style="font-size:22px;margin-bottom:12px">Selamat datang di Dmails 👋</div>
<p style="line-height:22px">Akun email Anda <b>${raka.address}</b> sudah aktif. Beberapa tips untuk memulai:</p>
<ul style="line-height:24px"><li>Tekan <b>C</b> untuk menulis pesan baru dan <b>/</b> untuk mencari.</li>
<li>Gunakan <b>label</b> untuk mengelompokkan email.</li><li>Beri <b>bintang</b> pada pesan penting agar mudah ditemukan.</li>
<li>Atur tanda tangan di menu <b>Setelan</b>.</li></ul><p>Salam,<br>Tim Dmails</p></div>`,
    ago: 10 * D,
  });

  put({
    userId: raka.id,
    folder: 'archive',
    from: { name: 'Andi Saputra', address: 'andi.saputra@contoh.id' },
    to: [me],
    subject: 'Foto reuni angkatan 2015',
    html: p('Raka!', 'Ini tautan album foto reuni kemarin. Seru banget ketemu lagi setelah sekian lama.', 'Jangan lupa grup alumni ya. Salam buat keluarga!', 'Andi'),
    ago: 12 * D,
    labels: [personal],
  });

  put({
    userId: raka.id,
    folder: 'sent',
    from: me,
    to: [{ name: 'Dimas Hartono', address: 'dimas@studiokita.id' }],
    subject: 'Penawaran kerja sama pengembangan aplikasi',
    html: p(
      'Halo Pak Dimas,',
      'Menindaklanjuti pertemuan kita minggu lalu, terlampir proposal kerja sama pengembangan aplikasi mobile untuk Studio Kita.',
      'Saya siap menjadwalkan diskusi lanjutan kapan pun Bapak sempat.',
      'Salam,<br>Raka Pratama',
    ),
    ago: 5 * D,
  });

  put({
    userId: raka.id,
    folder: 'drafts',
    from: me,
    to: [sitiAddr],
    subject: 'Ringkasan laporan bulanan',
    html: p('Hai Siti,', 'Berikut ringkasan laporan bulan ini: jumlah pengguna aktif naik 18% dan'),
    ago: 22 * H,
  });

  put({
    userId: raka.id,
    folder: 'spam',
    from: { name: 'Undian Berhadiah', address: 'hadiah@promo-undian.biz' },
    to: [me],
    subject: 'SELAMAT! Anda memenangkan Rp 100.000.000',
    html: p('Selamat! Nomor Anda terpilih sebagai pemenang undian. Kirimkan data diri dan nomor rekening untuk mencairkan hadiah.'),
    ago: 1 * D,
    read: false,
  });

  put({
    userId: raka.id,
    folder: 'trash',
    from: { name: 'Toko Serba Ada', address: 'promo@tokoserbaada.id' },
    to: [me],
    subject: 'Diskon hingga 70% khusus akhir pekan',
    html: p('Belanja hemat akhir pekan ini! Nikmati diskon hingga 70% untuk ribuan produk pilihan.'),
    ago: 2 * D,
  });

  console.log(`[seed] data demo dibuat — masuk dengan ${raka.address} / demo12345`);
}
