import { Refused } from '@/core/errors';
import { parseCsv } from './csv';
import { readXlsx } from './xlsx';

// The live run of show (PRD 1): a planner pastes the sheet's link and Sync pulls it. Smartsheet comes
// through its API as CSV. Excel is a OneDrive or SharePoint link shared with "Anyone with the link",
// downloaded as .xlsx. The link is typed by a user and fetched from the server, so the host lists are
// the trust boundary: https only, these hosts only, and every redirect is checked against the same list.
const SMARTSHEET = ['app.smartsheet.com'];
const MICROSOFT = ['sharepoint.com', 'onedrive.live.com', '1drv.ms', '1drv.com', 'microsoftpersonalcontent.com'];
const SIGN_IN = ['login.microsoftonline.com', 'login.live.com'];
const API = 'https://api.smartsheet.com/2.0';
export const MAX_BYTES = 5 * 1024 * 1024; // the upload's cap
const MAX_HOPS = 5;
const TIMEOUT_MS = 15_000; // a hung host must not hold the request

const on = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));
const PUBLIC_LINK = 'Share the workbook with "Anyone with the link can view" and paste that link.';

export type SheetLink = { kind: 'smartsheet' | 'excel'; url: URL };
type Fetch = (url: URL, init: RequestInit) => Promise<Response>;

/** The link if it is one Sync may fetch, else null. */
export function parseSheetLink(raw: string): SheetLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (on(url.hostname, SMARTSHEET)) return { kind: 'smartsheet', url };
  if (on(url.hostname, MICROSOFT)) return { kind: 'excel', url };
  return null;
}

/** The sheet as rows of strings. Every failure is a Refused with words the planner can act on. */
export async function fetchSheet(link: SheetLink, o: { token?: string; fetch?: Fetch } = {}): Promise<string[][]> {
  const f: Fetch = o.fetch ?? ((url, init) => fetch(url, init));
  try {
    return link.kind === 'smartsheet' ? await smartsheet(link.url, o.token, f) : await excel(link.url, f);
  } catch (e) {
    if (e instanceof Refused) throw e;
    // A timeout or a dropped connection. The cause can echo the address, never the token.
    throw new Refused(link.kind === 'smartsheet' ? 'Smartsheet did not answer. Try again.' : 'OneDrive did not answer. Try again.');
  }
}

async function capped(res: Response): Promise<Buffer> {
  const tooBig = () => new Refused('That sheet is over 5 MB.');
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw tooBig();
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// ponytail: one token for the whole deployment, so any planner can pull any sheet that account can open if they
// hold its link. Store a token per org, encrypted, when a second customer connects their own Smartsheet.
async function smartsheet(link: URL, token: string | undefined, f: Fetch): Promise<string[][]> {
  if (!token) throw new Refused('Smartsheet is not connected: SMARTSHEET_TOKEN is not set on this deployment.');
  const api = async (path: string, accept: string) => {
    const res = await f(new URL(API + path), { headers: { Authorization: `Bearer ${token}`, Accept: accept }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401 || res.status === 403) throw new Refused('Smartsheet refused the token, or the token cannot open that sheet.');
    if (!res.ok) throw new Refused(`Smartsheet answered ${res.status}.`);
    return res;
  };
  // The address bar holds the sheet's key, the API wants its id, and the list of sheets has both.
  // ponytail: the list is read on every sync; store the id beside the link if an account's list gets slow.
  const path = (u: URL) => u.pathname.replace(/\/+$/, '');
  const { data } = JSON.parse((await capped(await api('/sheets?includeAll=true', 'application/json'))).toString('utf8')) as { data?: { id: number; permalink?: string }[] };
  const sheet = data?.find((s) => s.permalink && URL.canParse(s.permalink) && path(new URL(s.permalink)) === path(link));
  if (!sheet) throw new Refused('Smartsheet has no sheet at that link for the connected account. Share the sheet with that account, then sync again.');
  return parseCsv((await capped(await api(`/sheets/${sheet.id}`, 'text/csv'))).toString('utf8').replace(/^\uFEFF/, ''));
}

// ponytail: `download=1` is what turns a share link into the file. A personal OneDrive link (1drv.ms) is proven
// against the real service; a SharePoint or OneDrive for Business link is not. If Microsoft changes the chain, the
// fix is Microsoft Graph's /shares endpoint.
// Seen against a real 1drv.ms link (2026-10-01): OneDrive's edge answers 403 "The request is blocked" to a client
// with no browser user agent, and the share hop sets a guest cookie (FedAuth) that the download hop wants back,
// or it redirects to a sign-in. A cookie only ever returns to the exact host that set it.
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function excel(link: URL, f: Fetch): Promise<string[][]> {
  let url = new URL(link);
  const jar = new Map<string, string>();
  let jarHost = '';
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (on(url.hostname, SIGN_IN)) throw new Refused(`That link asks for a Microsoft sign-in. ${PUBLIC_LINK}`);
    if (url.protocol !== 'https:' || !on(url.hostname, MICROSOFT)) throw new Refused('That link leads somewhere other than OneDrive or SharePoint.');
    // `set` rewrites the whole query, so it is skipped when the flag has already ridden along on a redirect.
    if ((hop === 0 || url.pathname.includes('/:x:/')) && url.searchParams.get('download') !== '1') url.searchParams.set('download', '1');
    if (url.hostname !== jarHost) {
      jar.clear();
      jarHost = url.hostname;
    }
    const headers: Record<string, string> = { 'User-Agent': BROWSER };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await f(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';', 1)[0]!;
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const to = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && to) {
      url = new URL(to, url);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Refused(`That link is not open to everyone. ${PUBLIC_LINK}`);
    if (!res.ok) throw new Refused(`OneDrive answered ${res.status} for that link.`);
    const buf = await capped(res);
    if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw new Refused(`That link returned a web page, not a workbook. ${PUBLIC_LINK}`);
    try {
      return readXlsx(buf);
    } catch {
      throw new Refused('That workbook could not be read. Keep the run of show on the first sheet, as .xlsx.');
    }
  }
  throw new Refused('That link redirected too many times.');
}
