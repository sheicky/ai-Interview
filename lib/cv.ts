/** Parse a CV PDF (bytes) into plain text. */
import { extractText, getDocumentProxy } from "unpdf";

export async function parseCvPdf(data: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}
