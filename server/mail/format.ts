import sanitizeHtml from 'sanitize-html';

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1">$1</a>');
  return `<div style="white-space:pre-wrap">${linked}</div>`;
}

// Cuplikan untuk daftar pesan; teks kutipan balasan/terusan tidak disertakan.
export function snippetOf(text: string): string {
  const cut = text.search(
    /(^|\n)\s*(Pada .{0,200}menulis:|On .{0,200}wrote:|-{5,} ?(Pesan yang diteruskan|Forwarded message))/,
  );
  const main = cut > 0 ? text.slice(0, cut) : text;
  return main.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function isEmail(value: string): boolean {
  return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(value);
}

export function cleanHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'span',
      'font',
      'center',
      'u',
      's',
      'strike',
      'del',
      'ins',
      'hr',
      'style',
      'h1',
      'h2',
    ],
    // <style> aman karena isi email selalu dirender di iframe sandbox tanpa skrip.
    allowVulnerableTags: true,
    allowedAttributes: {
      '*': [
        'style',
        'class',
        'align',
        'valign',
        'width',
        'height',
        'bgcolor',
        'color',
        'dir',
        'border',
        'cellpadding',
        'cellspacing',
        'colspan',
        'rowspan',
        'title',
        'lang',
      ],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      font: ['face', 'size', 'color'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
    allowProtocolRelative: true,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
      }),
    },
  });
}
