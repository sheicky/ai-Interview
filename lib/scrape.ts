/**
 * Fetch a company page and extract readable text. Best-effort: a simple fetch
 * won't render JS-heavy sites, so the caller treats an empty/thin result as
 * "company name only" (an Open Question in the design doc).
 */
export async function scrapeCompany(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; AI-Interviewer/0.1)" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return "";
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
