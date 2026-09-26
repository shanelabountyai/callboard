import { describe, expect, it } from 'vitest';
import { parseCsv, pickColumn, toRecords } from '@/lib/csv';
import { toE164 } from '@/lib/phone';
import { fmtTime, isHm, isYmd, zonedToUtc } from '@/lib/time';
import { excelTime, readXlsx } from '@/lib/xlsx';
import { writeXlsx } from '../helpers/xlsx';

describe('phone', () => {
  it('normalizes US numbers and keeps international ones', () => {
    expect(toE164('(555) 010-1234')).toBe('+15550101234');
    expect(toE164('1 555 010 1234')).toBe('+15550101234');
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164('12345')).toBeNull();
    expect(toE164('')).toBeNull();
  });
});

describe('csv', () => {
  it('handles quotes, doubled quotes, CRLF and blank lines', () => {
    const rows = parseCsv('name,mobile\r\n"Park, Jen",555-010-2001\n\n"He said ""hi""",x\n');
    expect(rows).toEqual([['name', 'mobile'], ['Park, Jen', '555-010-2001'], ['He said "hi"', 'x']]);
    const recs = toRecords(rows);
    expect(recs[0]).toEqual({ name: 'Park, Jen', mobile: '555-010-2001' });
    expect(pickColumn(recs[0]!, ['phone', 'mobile'])).toBe('mobile');
  });
});

describe('time', () => {
  it('turns a day and wall time in a zone into the instant', () => {
    expect(zonedToUtc('2026-10-03', '08:00', 'America/Chicago').toISOString()).toBe('2026-10-03T13:00:00.000Z'); // CDT
    expect(zonedToUtc('2026-12-05', '08:00', 'America/Chicago').toISOString()).toBe('2026-12-05T14:00:00.000Z'); // CST
    expect(fmtTime(new Date('2026-10-03T13:00:00Z'), 'America/Chicago')).toBe('8:00 AM');
    expect(isYmd('2026-10-03')).toBe(true);
    expect(isYmd('2026-13-03')).toBe(false);
    expect(isHm('23:59')).toBe(true);
    expect(isHm('24:00')).toBe(false);
  });
});

describe('xlsx', () => {
  it('reads the first sheet, with Excel day fractions as times', () => {
    const buf = writeXlsx([
      ['Time', 'Cue', 'Area & Room', 'Owner'],
      [0.395833333, 'Doors open', 'North Lobby', 'Marcus'],
      ['10:15', 'Keynote <live>', 'Hall A', ''],
    ]);
    const rows = readXlsx(buf);
    expect(rows[0]).toEqual(['Time', 'Cue', 'Area & Room', 'Owner']);
    expect(excelTime(rows[1]![0]!)).toBe('09:30');
    expect(rows[2]).toEqual(['10:15', 'Keynote <live>', 'Hall A', '']);
    expect(excelTime('7:05')).toBe('07:05');
    expect(excelTime('45123.5')).toBe('12:00'); // a full datetime serial keeps its time part
    expect(excelTime('TBD')).toBe('TBD');
  });
  it('rejects something that is not a workbook', () => {
    expect(() => readXlsx(Buffer.from('name,mobile\n'))).toThrow('Not a zip file');
  });
});
