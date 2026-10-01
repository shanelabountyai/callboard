import { inflateRawSync } from 'node:zlib';

// Minimal .xlsx reader: first sheet, shared and inline strings, numbers as written. No styles, so
// a time cell arrives as Excel's fraction of a day and `excelTime` turns it into "HH:MM".
// ponytail: hand-rolled zip + regex instead of a multi-megabyte dependency; reach for a library if
// merged cells, several sheets or zip64 files ever show up.

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + csize);
    if (method === 8) files.set(name, inflateRawSync(raw));
    else if (method === 0) files.set(name, Buffer.from(raw));
    else throw new Error(`Unsupported zip method ${method}`);
    p += 46 + nlen + elen + clen;
  }
  return files;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (NAMED[e.toLowerCase()] ?? `&${e};`),
  );
const texts = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join('');
const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** The first worksheet as rows of strings; empty cells are ''. */
export function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  const sheet = [...files.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
  if (!sheet) throw new Error('No worksheet found');
  const shared = [...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!));
  const rows: string[][] = [];
  for (const m of files.get(sheet)!.toString('utf8').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1]!;
    const inner = m[2] ?? '';
    const ref = /\br="([A-Z]+)(\d+)"/.exec(attrs);
    if (!ref) continue;
    const type = /\bt="(\w+)"/.exec(attrs)?.[1];
    let value: string;
    if (type === 's') value = shared[Number(/<v>(.*?)<\/v>/.exec(inner)?.[1])] ?? '';
    else if (type === 'inlineStr') value = texts(inner);
    else value = unescape(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
    (rows[Number(ref[2]) - 1] ??= [])[colIndex(ref[1]!)] = value;
  }
  return rows.filter(Boolean).map((r) => Array.from(r, (v) => v ?? ''));
}

/** "9:30", "09:30:00", "5:00 PM", "5pm" or Excel's 0.3958 (fraction of a day; a full datetime serial keeps its time part) → "09:30". */
export function excelTime(v: string): string {
  const hm = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(?:([ap])\.?m\.?)?/i.exec(v.trim());
  if (hm && (hm[2] || hm[3])) {
    const half = hm[3]?.toLowerCase();
    const h = (Number(hm[1]) % (half ? 12 : 24)) + (half === 'p' ? 12 : 0); // 12 AM is 00, 12 PM is 12
    return `${String(h).padStart(2, '0')}:${hm[2] ?? '00'}`;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || v.trim() === '') return v.trim();
  const mins = Math.round((n % 1) * 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}
