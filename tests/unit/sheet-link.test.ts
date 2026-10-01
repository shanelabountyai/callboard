import { describe, expect, it } from 'vitest';
import { rosLines } from '@/lib/ros';
import { fetchSheet, MAX_BYTES, parseSheetLink } from '@/lib/sheet-link';
import { writeXlsx } from '../helpers/xlsx';

// The live sheet's Sync fetches a link a user typed, from the server. A fake fetch stands in for Smartsheet and
// Microsoft, and records every address asked for, so a test can say what was never fetched.
type Reply = { status?: number; location?: string; body?: string | Buffer; length?: number; setCookie?: string };
function fake(replies: Record<string, Reply>) {
  const calls: { url: string; auth: string | null; cookie: string | null; agent: string | null }[] = [];
  const f = async (url: URL, init: RequestInit) => {
    const sent = new Headers(init.headers);
    calls.push({ url: url.href, auth: sent.get('authorization'), cookie: sent.get('cookie'), agent: sent.get('user-agent') });
    const r = replies[url.href] ?? replies[url.origin + url.pathname];
    if (!r) throw new Error(`unexpected fetch ${url.href}`);
    const headers = new Headers();
    if (r.location) headers.set('location', r.location);
    if (r.length) headers.set('content-length', String(r.length));
    if (r.setCookie) headers.append('set-cookie', r.setCookie);
    const status = r.status ?? (r.location ? 302 : 200);
    return new Response(status >= 300 && status < 400 ? null : new Uint8Array(Buffer.from(r.body ?? '')), { status, headers });
  };
  return { f, calls };
}
const link = (raw: string) => {
  const l = parseSheetLink(raw);
  if (!l) throw new Error(`not a sheet link: ${raw}`);
  return l;
};
const SHARE = 'https://acme.sharepoint.com/:x:/g/personal/pat/EaBcD?e=k9';
const SHEET = 'https://app.smartsheet.com/sheets/abcKEY123?view=grid';
const workbook = writeXlsx([['Time', 'Cue'], ['09:15', 'Keynote']]);

describe('sheet link', () => {
  it('takes Smartsheet, SharePoint and OneDrive links and nothing else', () => {
    expect(parseSheetLink(SHEET)?.kind).toBe('smartsheet');
    expect(parseSheetLink(` ${SHARE} `)?.kind).toBe('excel');
    expect(parseSheetLink('https://1drv.ms/x/c/abc/def')?.kind).toBe('excel');
    for (const bad of [
      '', 'x', 'http://acme.sharepoint.com/:x:/g/a', 'https://example.com/sheet.xlsx', 'https://sharepoint.com.evil.test/a', 'https://evilsharepoint.com/a',
      'https://acme.sharepoint.com.:443/a', 'https://user:pw@acme.sharepoint.com/a', 'https://acme.sharepoint.com:8443/a', 'https://169.254.169.254/latest', 'file:///etc/passwd',
    ]) expect(parseSheetLink(bad), bad).toBeNull();
  });

  it('downloads an Excel share link, following a redirect on the same tenant', async () => {
    const { f, calls } = fake({
      'https://acme.sharepoint.com/:x:/g/personal/pat/EaBcD': { location: '/personal/pat/_layouts/15/download.aspx?UniqueId=7' },
      'https://acme.sharepoint.com/personal/pat/_layouts/15/download.aspx': { body: workbook },
    });
    expect(await fetchSheet(link(SHARE), { fetch: f })).toEqual([['Time', 'Cue'], ['09:15', 'Keynote']]);
    expect(calls[0]!.url).toBe(`${SHARE}&download=1`);
    expect(calls[1]!.url).toBe('https://acme.sharepoint.com/personal/pat/_layouts/15/download.aspx?UniqueId=7'); // a signed address is fetched as given
  });

  // The chain a real 1drv.ms link walked on 2026-10-01: the share hop sets a guest cookie and the file hop wants it.
  it('walks a personal OneDrive link, returning a cookie to the host that set it and to no other', async () => {
    const { f, calls } = fake({
      'https://1drv.ms/x/c/abc/def': { status: 301, location: 'https://onedrive.live.com/:x:/g/personal/ABC/def?resid=ABC!s1&ithint=file%2cxlsx&download=1' },
      'https://onedrive.live.com/:x:/g/personal/ABC/def': { location: '/personal/abc/Documents/Show.xlsx?ga=1', setCookie: 'FedAuth=guest; path=/; secure; HttpOnly' },
      'https://onedrive.live.com/personal/abc/Documents/Show.xlsx': { location: 'https://my.microsoftpersonalcontent.com/download/7' },
      'https://my.microsoftpersonalcontent.com/download/7': { body: workbook },
    });
    expect(await fetchSheet(link('https://1drv.ms/x/c/abc/def'), { fetch: f })).toEqual([['Time', 'Cue'], ['09:15', 'Keynote']]);
    expect(calls.map((c) => c.cookie)).toEqual([null, null, 'FedAuth=guest', null]);
    expect(calls[1]!.url).toBe('https://onedrive.live.com/:x:/g/personal/ABC/def?resid=ABC!s1&ithint=file%2cxlsx&download=1'); // not re-encoded
    expect(calls.every((c) => c.agent?.startsWith('Mozilla/'))).toBe(true); // OneDrive blocks a client without one
  });

  it('never follows a redirect off the list, and names a sign-in when that is where it leads', async () => {
    const off = fake({ 'https://acme.sharepoint.com/:x:/g/personal/pat/EaBcD': { location: 'http://169.254.169.254/latest/meta-data' } });
    await expect(fetchSheet(link(SHARE), { fetch: off.f })).rejects.toThrow('somewhere other than OneDrive or SharePoint');
    expect(off.calls).toHaveLength(1);

    const signIn = fake({ 'https://acme.sharepoint.com/:x:/g/personal/pat/EaBcD': { location: 'https://login.microsoftonline.com/common/oauth2/authorize' } });
    await expect(fetchSheet(link(SHARE), { fetch: signIn.f })).rejects.toThrow('asks for a Microsoft sign-in');
    expect(signIn.calls).toHaveLength(1);

    const loop = fake({ 'https://acme.sharepoint.com/:x:/g/personal/pat/EaBcD': { location: SHARE } });
    await expect(fetchSheet(link(SHARE), { fetch: loop.f })).rejects.toThrow('too many times');
  });

  it('refuses a web page, a file over the cap and a broken workbook', async () => {
    const at = (r: Reply) => fake({ 'https://acme.sharepoint.com/:x:/g/personal/pat/EaBcD': r }).f;
    await expect(fetchSheet(link(SHARE), { fetch: at({ body: '<!doctype html><title>Sign in</title>' }) })).rejects.toThrow('web page, not a workbook');
    await expect(fetchSheet(link(SHARE), { fetch: at({ body: 'x', length: MAX_BYTES + 1 }) })).rejects.toThrow('over 5 MB');
    await expect(fetchSheet(link(SHARE), { fetch: at({ body: Buffer.alloc(MAX_BYTES + 1) }) })).rejects.toThrow('over 5 MB'); // a host that does not say its size
    await expect(fetchSheet(link(SHARE), { fetch: at({ body: Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(40)]) }) })).rejects.toThrow('could not be read');
    await expect(fetchSheet(link(SHARE), { fetch: at({ status: 403 }) })).rejects.toThrow('not open to everyone');
    await expect(fetchSheet(link(SHARE), { fetch: async () => { throw new Error('socket hang up'); } })).rejects.toThrow('OneDrive did not answer');
  });

  it('pulls a Smartsheet sheet by its link, sending the token to the API only', async () => {
    const replies = {
      'https://api.smartsheet.com/2.0/sheets': { body: JSON.stringify({ data: [{ id: 11, permalink: 'https://app.smartsheet.com/sheets/other' }, { id: 4583173393803140, permalink: 'https://app.smartsheet.com/sheets/abcKEY123' }] }) },
      'https://api.smartsheet.com/2.0/sheets/4583173393803140': { body: '\uFEFFStart,Item,Room\r\n9:30,"Doors, north",Lobby\r\n' },
    };
    const { f, calls } = fake(replies);
    expect(await fetchSheet(link(SHEET), { token: 'tok', fetch: f })).toEqual([['Start', 'Item', 'Room'], ['9:30', 'Doors, north', 'Lobby']]);
    expect(calls.map((c) => [new URL(c.url).hostname, c.auth])).toEqual([['api.smartsheet.com', 'Bearer tok'], ['api.smartsheet.com', 'Bearer tok']]);

    await expect(fetchSheet(link('https://app.smartsheet.com/sheets/unknown'), { token: 'tok', fetch: fake(replies).f })).rejects.toThrow('no sheet at that link');
    await expect(fetchSheet(link(SHEET), { token: 'tok', fetch: fake({ 'https://api.smartsheet.com/2.0/sheets': { status: 401 } }).f })).rejects.toThrow('refused the token');
    const none = fake({});
    await expect(fetchSheet(link(SHEET), { fetch: none.f })).rejects.toThrow('SMARTSHEET_TOKEN is not set');
    expect(none.calls).toHaveLength(0);
  });
});

describe('run of show lines', () => {
  it('matches columns by header and numbers a repeated line', () => {
    expect(rosLines([['When', 'What', 'Room'], ['0.375', 'Doors', 'Lobby'], ['09:00', 'Doors', ''], ['', '', 'x']])).toEqual([
      { at: '09:00', cue: 'Doors', area: 'Lobby', owner: '', sortOrder: 0, sourceKey: '09:00|Doors' },
      { at: '09:00', cue: 'Doors', area: '', owner: '', sortOrder: 1, sourceKey: '09:00|Doors#2' },
    ]);
    expect(rosLines([['Name', 'Phone'], ['Tom', '555']])).toBeNull();
    expect(rosLines([])).toBeNull();
  });
});
