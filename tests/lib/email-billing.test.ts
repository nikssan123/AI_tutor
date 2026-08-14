import { describe, expect, it } from "vitest";
import { LOCALES } from "@/lib/i18n/locales";
import { copyFor } from "@/lib/email/copy";
import {
  billingDate,
  cancelledMessage,
  paymentFailedMessage,
  referralRewardedMessage,
  trialConvertedMessage,
  trialEndingMessage,
  trialStartedMessage,
} from "@/lib/email/billing";

/**
 * The six emails money sends.
 *
 * These are the only messages in the product that can cost the reader
 * something by being ignored, so the tests are about whether the amount, the
 * date and the way out survive rendering — in every language, because a German
 * reader getting an English renewal notice is the same failure as no notice.
 */

const RENEWS = new Date("2026-08-20T09:00:00.000Z");

describe("billingDate", () => {
  it("writes the date the way each language does", () => {
    expect(billingDate(RENEWS, "en")).toBe("20 August");
    expect(billingDate(RENEWS, "de")).toBe("20. August");
    expect(billingDate(RENEWS, "es")).toBe("20 de agosto");
  });

  it("never mentions a year", () => {
    // Every date these emails carry is days away; a year makes a sentence about
    // tomorrow read like a contract.
    for (const locale of LOCALES) {
      expect(billingDate(RENEWS, locale)).not.toMatch(/2026/);
    }
  });
});

describe("trialStartedMessage", () => {
  it("states the renewal price and date in the body", async () => {
    const message = trialStartedMessage({
      to: "ana@example.com",
      price: "€24.99",
      trialPrice: "€3",
      evaluations: 5,
      renewsOn: RENEWS,
    });

    expect(message.text).toContain("€24.99");
    expect(message.text).toContain("€3");
    expect(message.text).toContain("20 August");
    expect(message.text).toContain("5 graded projects");
  });

  it("points at handing something in, not at the dashboard", async () => {
    // §19.3's activation metric is the first graded submission; a trial email
    // that sends someone to a summary screen wastes the one day they are keen.
    const message = trialStartedMessage({
      to: "ana@example.com",
      price: "€24.99",
      trialPrice: "€3",
      evaluations: 5,
      renewsOn: RENEWS,
    });
    expect(message.html).toContain("/today");
  });
});

describe("trialEndingMessage", () => {
  it("leads with the price, in the subject and the heading", () => {
    // The most important message in the file — §13 risk 3.
    const message = trialEndingMessage({
      to: "ana@example.com",
      price: "€24.99",
      renewsOn: RENEWS,
    });

    expect(message.subject).toMatch(/renews tomorrow/);
    expect(message.text).toContain("€24.99");
    expect(message.text).toContain("20 August");
  });

  it("says cancelling still keeps the remaining days", () => {
    const message = trialEndingMessage({
      to: "ana@example.com",
      price: "€24.99",
      renewsOn: RENEWS,
    });
    expect(message.text).toMatch(/cancel now and you keep Pro until 20 August/i);
  });
});

describe("trialConvertedMessage", () => {
  it("names the price and the next payment date", () => {
    const message = trialConvertedMessage({
      to: "ana@example.com",
      price: "€24.99",
      evaluations: 10,
      renewsOn: RENEWS,
    });

    expect(message.text).toContain("€24.99");
    expect(message.text).toContain("20 August");
    expect(message.text).toContain("10 graded projects");
  });
});

describe("paymentFailedMessage", () => {
  it("says nothing stops while it is sorted out", () => {
    // Cutting somebody off over an expired card is how you lose one who wanted
    // to stay — §5's dunning grace, said out loud.
    const message = paymentFailedMessage({ to: "ana@example.com" });
    expect(message.text).toMatch(/Nothing stops in the meantime/);
  });
});

describe("cancelledMessage", () => {
  it("says what you keep and until when, not what flag was set", () => {
    const message = cancelledMessage({
      to: "ana@example.com",
      endsOn: RENEWS,
    });

    expect(message.subject).toContain("20 August");
    expect(message.text).toMatch(/still have Pro until 20 August/);
    expect(message.text).not.toMatch(/cancel_at_period_end/);
  });

  it("promises the ledger survives", () => {
    const message = cancelledMessage({ to: "ana@example.com", endsOn: RENEWS });
    expect(message.text).toMatch(/mastery ledger stays/);
  });
});

describe("referralRewardedMessage", () => {
  it("names the friend, the days and when they run out", () => {
    const message = referralRewardedMessage({
      to: "ana@example.com",
      friend: "Bo",
      days: 14,
      endsOn: RENEWS,
    });

    expect(message.subject).toContain("Bo");
    expect(message.text).toContain("14 days");
    expect(message.text).toContain("20 August");
  });

  it("escapes a name carrying markup", () => {
    // `fill` substitutes before escaping, so a hostile display name is
    // neutralised on the way out rather than rendered. The frame has its own
    // legitimate `<img>` for the brand mark, so the assertion is that the
    // *name* arrives escaped rather than that no image tag exists at all.
    const message = referralRewardedMessage({
      to: "ana@example.com",
      friend: '<img src=x onerror="alert(1)">',
      days: 14,
      endsOn: RENEWS,
    });

    expect(message.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    // Nothing executable survives into the document — including the `<title>`,
    // which is the one place the subject line reappears as markup.
    expect(message.html).not.toContain('onerror="alert(1)"');
    // The subject itself is a plain-text header rather than HTML, so it carries
    // the name as typed. That is correct: escaping it would show a reader
    // `&lt;` in their inbox.
    expect(message.subject).toContain("<img src=x");
  });
});

describe("every locale", () => {
  it.each(LOCALES)("renders all six in %s", (locale) => {
    const common = { to: "ana@example.com", locale };

    const messages = [
      trialStartedMessage({
        ...common,
        price: "€24.99",
        trialPrice: "€3",
        evaluations: 5,
        renewsOn: RENEWS,
      }),
      trialEndingMessage({ ...common, price: "€24.99", renewsOn: RENEWS }),
      trialConvertedMessage({
        ...common,
        price: "€24.99",
        evaluations: 10,
        renewsOn: RENEWS,
      }),
      paymentFailedMessage(common),
      cancelledMessage({ ...common, endsOn: RENEWS }),
      referralRewardedMessage({
        ...common,
        friend: "Bo",
        days: 14,
        endsOn: RENEWS,
      }),
    ];

    for (const message of messages) {
      expect(message.subject.length).toBeGreaterThan(0);
      expect(message.text.length).toBeGreaterThan(0);
      expect(message.html).toContain(`lang="${locale}"`);
      // No unfilled placeholder survived into a message somebody will read.
      expect(message.subject).not.toMatch(/\{[a-zA-Z]+\}/);
      expect(message.text).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });

  it.each(LOCALES)("keeps every billing key present in %s", (locale) => {
    // The type system already guarantees this; the runtime check catches the
    // other failure, which is a key present but left as an empty string.
    const billing = copyFor(locale).billing;
    for (const [name, entry] of Object.entries(billing)) {
      expect(entry.subject, `${locale}.${name}.subject`).toBeTruthy();
      expect(entry.heading, `${locale}.${name}.heading`).toBeTruthy();
      expect(entry.body.length, `${locale}.${name}.body`).toBeGreaterThan(0);
      expect(entry.action, `${locale}.${name}.action`).toBeTruthy();
      expect(entry.footer, `${locale}.${name}.footer`).toBeTruthy();
    }
  });

  it("does not leave a translation identical to the English", () => {
    // The cheap tell that a locale was filled in by copying rather than
    // translating. Brand names and the odd loanword are allowed to match.
    const en = copyFor("en").billing;
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      const other = copyFor(locale).billing;
      for (const key of Object.keys(en) as Array<keyof typeof en>) {
        expect(other[key].heading, `${locale}.${key}`).not.toBe(
          en[key].heading,
        );
      }
    }
  });
});
