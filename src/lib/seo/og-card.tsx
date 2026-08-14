import { light } from "@/lib/theme";
import type { StatusTone } from "@/components/ui";
import { OG_FONT_FAMILY } from "@/lib/seo/og-fonts";
import { ORGANISATION_NAME } from "@/lib/seo/jsonld";
import { titleFontSize, type OgCard } from "@/lib/seo/og";

/**
 * The share card, drawn.
 *
 * Satori is not a browser: no CSS variables, no stylesheet, no `currentColor`,
 * and every element holding more than one child needs `display: flex` spelled
 * out. So this is the one place in the product where a palette value is written
 * as a literal — and it is imported from `theme.ts` rather than typed out,
 * because a card in last season's accent is exactly the kind of drift §8.5.4
 * says nobody notices.
 *
 * It is always the light palette. A share card has no viewer to ask, and the
 * light ground with one jade accent *is* the identity (§8.5.3's "quiet
 * instrument"); a dark card would be a second brand nobody chose.
 */

/** The same mapping `Status` uses, so a dot means the same thing in both. */
const DOT: Record<StatusTone, string> = {
  verified: light.accent,
  attention: light.attention,
  problem: light.problem,
  neutral: light.inkFaint,
};

export function OgCardImage({ card }: { card: OgCard }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: light.ground,
        fontFamily: OG_FONT_FAMILY,
        // The accent rule, as a top border rather than an absolutely positioned
        // child: one less element, and it cannot drift out of alignment.
        borderTop: `12px solid ${light.accent}`,
        padding: "64px 72px 56px",
        position: "relative",
      }}
    >
      {/*
       * One block, centred, rather than a top half and a bottom half pinned to
       * opposite edges. The first render of this card put ~150px of nothing
       * across its middle: the facts had been pushed to the floor by a `flex: 1`
       * and read as a footer to a card that had already ended.
       */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
        }}
      >
        {card.eyebrow ? (
          <div
            style={{
              display: "flex",
              marginBottom: 24,
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: light.accent,
            }}
          >
            {card.eyebrow}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            marginTop: 24,
            fontSize: titleFontSize(card.title),
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: light.ink,
          }}
        >
          {card.title}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 24,
            maxWidth: 900,
            fontSize: 30,
            lineHeight: 1.4,
            color: light.inkMuted,
          }}
        >
          {card.lead}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {card.facts.length > 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginTop: 48,
                fontSize: 28,
                color: light.ink,
              }}
            >
              {card.facts.map((fact, i) => (
                <div key={fact} style={{ display: "flex", alignItems: "center" }}>
                  {i > 0 ? (
                    <div style={{ display: "flex", margin: "0 16px", color: light.inkFaint }}>
                      ·
                    </div>
                  ) : null}
                  <div style={{ display: "flex" }}>{fact}</div>
                </div>
              ))}
            </div>
          ) : null}

          {card.badge ? (
            // §8.5.5's "a dot plus a word", and its ban on colour as the sole
            // carrier of meaning — which bites hardest here, where the image
            // may be read by someone who cannot see the dot at all.
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginTop: card.facts.length > 0 ? 24 : 48,
                fontSize: 26,
                color: light.inkMuted,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 16,
                  height: 16,
                  marginRight: 12,
                  borderRadius: 999,
                  backgroundColor: DOT[card.badge.tone],
                }}
              />
              {card.badge.label}
            </div>
          ) : null}
        </div>
      </div>

      {/*
       * The signature, and the reason no card carries the name anywhere else.
       * The brand card originally opened with "ONLINE_UNI" as its eyebrow and
       * closed with this, which read as a rendering fault rather than as
       * branding.
       */}
      <div
        style={{
          position: "absolute",
          right: 72,
          bottom: 56,
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 26,
          color: light.inkFaint,
        }}
      >
        {/*
         * The mark, drawn rather than imported. `LogoMark` cannot be reused
         * here: it leans on `currentColor` and `var(--accent)`, and Satori has
         * neither. So the paths are repeated with the palette written out —
         * the same trade this file already makes for every other colour.
         *
         * The stem takes `inkFaint` rather than `ink`, because this is a
         * signature and not a title: it sits at the same weight as the name
         * beside it. The arm keeps the full accent, since a jade that dims to
         * match a signature is no longer the colour that means verified.
         */}
        <svg width={30} height={30} viewBox="0 0 24 24" fill="none">
          <path
            d="M4.25 19V8.75l7 7.5"
            stroke={light.inkFaint}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M11.25 16.25 20 5.25"
            stroke={light.accent}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {ORGANISATION_NAME}
      </div>
    </div>
  );
}
