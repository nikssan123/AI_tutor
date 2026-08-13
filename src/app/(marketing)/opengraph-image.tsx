import { ImageResponse } from "next/og";
import { OgCardImage } from "@/lib/seo/og-card";
import { OG_FONTS } from "@/lib/seo/og-fonts";
import { brandCard, OG_SIZE } from "@/lib/seo/og";

/**
 * The default share card for the whole marketing surface.
 *
 * It sits on the route group rather than on `/`, so every marketing page
 * inherits it and none of them can end up as a bare blue link in a feed. The
 * two page types worth saying something specific about override it.
 *
 * Nothing under `(app)` inherits anything: those routes are `noindex` and
 * private, and a card for a page a recipient cannot open is a worse artefact
 * than no card at all.
 */
export const alt =
  "online_uni — learn anything, and have the work you produce marked against a published checklist";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 86_400;

export default function Image() {
  return new ImageResponse(<OgCardImage card={brandCard()} />, {
    ...size,
    fonts: [...OG_FONTS],
  });
}
