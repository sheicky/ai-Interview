/**
 * Fetch a company page and extract readable text. Best-effort: a simple fetch
 * won't render JS-heavy sites, so the caller treats an empty/thin result as
 * "company name only" (an Open Question in the design doc).
 *
 * SSRF guard: companyUrl comes straight from the public intake form, so before
 * fetching we require an http(s) URL whose resolved address is not private /
 * loopback / link-local / cloud-metadata. A disallowed URL is treated exactly
 * like a scrape failure (returns "" → "company name only"), never fetched.
 * Redirects are followed manually and every hop is re-validated, so a public
 * page can't 302 us onto an internal host. Residual: a DNS-rebind between our
 * lookup and fetch's own resolution is not yet closed (needs IP-pinned connect).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // unparseable → reject
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpv4(ip);
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true; // loopback / unspecified
  if (v.startsWith("::ffff:")) return isPrivateIpv4(v.slice(7)); // IPv4-mapped
  if (v.startsWith("64:ff9b:")) return true; // NAT64 (can embed any IPv4)
  if (v.startsWith("2002:")) return true; // 6to4 (embeds an IPv4)
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true; // link-local / ULA
  return false;
}

/** Resolve and validate a user-supplied URL is a public http(s) target. Throws if not. */
async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw); // throws on malformed input
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("unsupported scheme");
  if (url.username || url.password) throw new Error("credentials not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateIp))
    throw new Error("blocked host");
  return url;
}

/** Fetch, following redirects manually and re-validating every hop against the
 *  SSRF guard so a public page can't bounce us onto an internal host. */
async function safeFetch(raw: string, maxHops = 4): Promise<Response> {
  let next = raw;
  for (let hop = 0; hop < maxHops; hop++) {
    const target = await assertPublicHttpUrl(next); // throws on malformed/disallowed
    const res = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; AI-Interviewer/0.1)" },
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      next = new URL(location, target).toString(); // resolve relative redirects
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

export async function scrapeCompany(url: string): Promise<string> {
  let res: Response;
  try {
    res = await safeFetch(url);
  } catch {
    return ""; // malformed, disallowed (SSRF guard), or fetch failure → "company name only"
  }
  if (!res.ok) return "";

  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 8000);
}
