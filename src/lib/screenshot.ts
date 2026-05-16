/**
 * Capture a DOM node as a base64 JPEG data URL using html2canvas. Caps the
 * output at ~700KB so it can safely embed inside a Firestore document
 * (1MB doc limit). Returns `null` on failure or if the screenshot would
 * exceed the cap even at low quality.
 */
import html2canvas from "html2canvas";

export async function captureElementAsDataUrl(
  el: HTMLElement,
  opts: { maxBytes?: number; maxWidth?: number } = {}
): Promise<string | null> {
  const maxBytes = opts.maxBytes ?? 700_000;
  const maxWidth = opts.maxWidth ?? 960;
  try {
    const canvas = await html2canvas(el, {
      backgroundColor: "#ffffff",
      scale: 1,
      useCORS: true,
      logging: false,
      width: Math.min(el.scrollWidth, maxWidth),
    });
    // Try progressively lower quality until it fits.
    for (const q of [0.7, 0.55, 0.4, 0.25]) {
      const url = canvas.toDataURL("image/jpeg", q);
      // base64 length ~ 4/3 of byte length; cheap byte estimate:
      const bytes = Math.floor((url.length - "data:image/jpeg;base64,".length) * 0.75);
      if (bytes <= maxBytes) return url;
    }
    return null;
  } catch (err) {
    console.warn("captureElementAsDataUrl failed:", err);
    return null;
  }
}

/**
 * Build a temporary off-screen DOM card for raw text so the screenshot has
 * predictable framing (e.g. when the source element has already been cleared
 * after submit). Caller is responsible for removing the node.
 */
export function buildTextScreenshotCard(args: {
  title: string;
  body: string;
  meta?: string;
}): HTMLElement {
  const card = document.createElement("div");
  card.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:0",
    "width:560px",
    "padding:20px",
    "background:#fff7ed",
    "border:1px solid #fdba74",
    "border-radius:12px",
    "font-family:system-ui,-apple-system,Segoe UI,sans-serif",
    "color:#1c1917",
    "z-index:-1",
  ].join(";");
  card.innerHTML = `
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#c2410c;font-weight:600;margin-bottom:8px;">
      Flagged communication
    </div>
    <div style="font-size:15px;font-weight:600;margin-bottom:8px;">${escapeHtml(args.title)}</div>
    <div style="font-size:14px;line-height:1.5;white-space:pre-wrap;background:#fff;border:1px solid #fed7aa;border-radius:8px;padding:12px;">${escapeHtml(args.body)}</div>
    ${args.meta ? `<div style="margin-top:10px;font-size:12px;color:#78716c;">${escapeHtml(args.meta)}</div>` : ""}
  `;
  document.body.appendChild(card);
  return card;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
