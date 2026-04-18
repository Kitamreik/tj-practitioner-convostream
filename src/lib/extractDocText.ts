/**
 * Lightweight, dependency-free text extraction for the New Conversation
 * dialog. Supports plain text, markdown, CSV, JSON, and HTML directly.
 * For PDFs we fall back to a best-effort pass that pulls the readable
 * `(...)Tj`/`(...)TJ` string operands out of uncompressed content streams —
 * good enough to preview the body of most simple, non-image PDFs without
 * shipping a 500KB pdf.js bundle. For unsupported binary formats (DOCX,
 * complex PDFs) we surface a clear, user-actionable error.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB upload cap

export interface ExtractedDoc {
  text: string;
  truncated: boolean;
  sourceName: string;
}

export class ExtractDocError extends Error {}

function detectKind(file: File): "text" | "pdf" | "docx" | "unsupported" {
  const name = file.name.toLowerCase();
  const type = file.type;
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    name.endsWith(".json") ||
    name.endsWith(".log") ||
    name.endsWith(".html") ||
    name.endsWith(".htm") ||
    name.endsWith(".xml")
  ) {
    return "text";
  }
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    name.endsWith(".docx") ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  return "unsupported";
}

/**
 * In-browser DOCX extraction. A .docx is a ZIP whose `word/document.xml`
 * holds the body. We unzip with fflate, then strip everything except the
 * text inside `<w:t>` runs, with `<w:p>` paragraph breaks preserved.
 */
async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter: (f) => f.name === "word/document.xml",
    });
  } catch {
    throw new ExtractDocError("This .docx file appears corrupted or password-protected.");
  }
  const xmlBytes = unzipped["word/document.xml"];
  if (!xmlBytes) throw new ExtractDocError("Could not locate document.xml inside the .docx.");
  const xml = strFromU8(xmlBytes);
  // Convert paragraph and break tags to newlines so the message keeps shape.
  const withBreaks = xml
    .replace(/<w:p[\s>][^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br[\s/>][^>]*\/?>/g, "\n")
    .replace(/<w:tab[\s/>][^>]*\/?>/g, "\t");
  // Pull text out of <w:t> runs (preserves xml:space="preserve" content).
  const out: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  // We need to interleave text with paragraph breaks, so walk the
  // `withBreaks` string and emit either text-run content or a newline.
  const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|\n/g;
  let t: RegExpExecArray | null;
  while ((t = tokenRe.exec(withBreaks)) !== null) {
    if (t[0] === "\n") out.push("\n");
    else out.push(decodeXmlEntities(t[1]));
  }
  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

/**
 * Strip HTML tags + collapse whitespace. Used for .html/.htm uploads so the
 * conversation message gets the readable body, not the raw markup.
 */
function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best-effort PDF text extraction from raw bytes. Looks for the standard
 * `(text) Tj` and `[(text) ...] TJ` operators inside the content stream.
 * Will return empty string for compressed (FlateDecode) streams or
 * image-only PDFs — caller surfaces a helpful error in that case.
 */
function extractPdfText(bytes: Uint8Array): string {
  // Latin-1 decode preserves PDF's binary-ish content as a searchable string.
  let raw = "";
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
  const out: string[] = [];
  // Match parenthesized strings preceded by Tj or part of a TJ array.
  const re = /\(((?:\\.|[^()\\])*)\)\s*(Tj|TJ|')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const decoded = m[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
    if (decoded.trim()) out.push(decoded);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export async function extractDocText(file: File): Promise<ExtractedDoc> {
  if (file.size > MAX_BYTES) {
    throw new ExtractDocError(
      `File is ${(file.size / 1024 / 1024).toFixed(1)}MB; max 2MB. Try a smaller excerpt.`
    );
  }

  const kind = detectKind(file);
  if (kind === "unsupported") {
    throw new ExtractDocError(
      `Unsupported file type. Upload .txt, .md, .csv, .json, .html, .pdf, or .docx.`
    );
  }

  let text: string;
  if (kind === "text") {
    const raw = await file.text();
    text = file.name.toLowerCase().match(/\.html?$/) ? stripHtml(raw) : raw.trim();
  } else if (kind === "docx") {
    const buf = new Uint8Array(await file.arrayBuffer());
    text = await extractDocxText(buf);
    if (!text) {
      throw new ExtractDocError(
        "This .docx contained no readable text (it may be image-only)."
      );
    }
  } else {
    const buf = new Uint8Array(await file.arrayBuffer());
    text = extractPdfText(buf);
    if (!text) {
      throw new ExtractDocError(
        "Could not extract text from this PDF (likely scanned or compressed). Paste the relevant excerpt manually."
      );
    }
  }

  const MAX_CHARS = 4000;
  const truncated = text.length > MAX_CHARS;
  return {
    text: truncated ? text.slice(0, MAX_CHARS) + "\n\n…(truncated)" : text,
    truncated,
    sourceName: file.name,
  };
}
