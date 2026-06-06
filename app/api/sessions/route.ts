/**
 * POST /api/sessions — create an interview session from the intake form.
 *
 * multipart/form-data: cv (PDF file), jd (text), company (text), companyUrl (text, optional)
 *   1. validate inputs
 *   2. parse the CV PDF → text
 *   3. scrape the company URL → text (best-effort, optional)
 *   4. create the session row (SQLite)
 *   5. embed [CV, JD, company] into LanceDB tagged with session_id
 * returns { session_id, company_scraped }
 */
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createSession } from "@/lib/db";
import { addSessionDocs } from "@/lib/rag";
import { parseCvPdf } from "@/lib/cv";
import { scrapeCompany } from "@/lib/scrape";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CV_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  const form = await req.formData();
  const cv = form.get("cv");
  const jd = String(form.get("jd") ?? "").trim();
  const company = String(form.get("company") ?? "").trim();
  const companyUrl = String(form.get("companyUrl") ?? "").trim();

  if (!(cv instanceof File) || cv.size === 0)
    return Response.json({ error: "Please attach your CV (PDF)." }, { status: 400 });
  if (cv.size > MAX_CV_BYTES)
    return Response.json({ error: "CV must be under 5MB." }, { status: 413 });
  if (!jd) return Response.json({ error: "Please paste the job description." }, { status: 400 });
  if (!company) return Response.json({ error: "Please enter the company name." }, { status: 400 });

  let cvText: string;
  try {
    cvText = await parseCvPdf(new Uint8Array(await cv.arrayBuffer()));
  } catch {
    return Response.json({ error: "Could not read that PDF. Try another file." }, { status: 422 });
  }
  if (!cvText)
    return Response.json(
      { error: "No text found in the PDF (is it a scanned image?)." },
      { status: 422 },
    );

  let companyText = "";
  if (companyUrl) {
    try {
      companyText = await scrapeCompany(companyUrl);
    } catch {
      companyText = "";
    }
  }

  const sessionId = randomUUID();
  createSession({ id: sessionId, company, companyUrl: companyUrl || undefined });

  await addSessionDocs(sessionId, [
    { kind: "cv", text: cvText },
    { kind: "jd", text: jd },
    ...(companyText ? [{ kind: "company", text: companyText }] : []),
  ]);

  return Response.json({ session_id: sessionId, company_scraped: Boolean(companyText) });
}
