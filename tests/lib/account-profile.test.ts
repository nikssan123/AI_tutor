import { describe, expect, it } from "vitest";
import {
  isValidTimezone,
  MAX_HANDLE_LENGTH,
  MAX_NAME_LENGTH,
  normaliseHandle,
  parseProfileForm,
} from "@/lib/account/profile";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const valid = {
  name: "Nikolay",
  handle: "nikolay",
  locale: "en",
  timezone: "Europe/Sofia",
};

describe("normaliseHandle", () => {
  it("lower-cases rather than merely accepting", () => {
    // The unique index is case-sensitive, so without this `Nikolay` and
    // `nikolay` are two Proof Page URLs a reader cannot tell apart.
    expect(normaliseHandle("Nikolay")).toEqual({ ok: true, handle: "nikolay" });
  });

  it("treats empty as no handle, not as an invalid one", () => {
    // It is published. The answer to publishing something you regret cannot be
    // "contact support".
    expect(normaliseHandle("")).toEqual({ ok: true, handle: null });
    expect(normaliseHandle("   ")).toEqual({ ok: true, handle: null });
  });

  it.each([
    ["ab", "too short"],
    ["a".repeat(MAX_HANDLE_LENGTH + 1), "too long"],
  ])("rejects %s (%s)", (handle) => {
    const result = normaliseHandle(handle);
    expect(result.ok).toBe(false);
  });

  it.each([["-nikolay"], ["nikolay-"], ["niko--lay"], ["niko lay"], ["niko_lay"], ["niko.lay"]])(
    "rejects %s",
    (handle) => {
      expect(normaliseHandle(handle).ok).toBe(false);
    },
  );

  it.each([["nikolay"], ["niko-lay"], ["n1k0-l4y-2"], ["abc"]])(
    "accepts %s",
    (handle) => {
      expect(normaliseHandle(handle)).toEqual({ ok: true, handle });
    },
  );
});

describe("isValidTimezone", () => {
  it("checks against the platform's tz database, not a list we maintain", () => {
    expect(isValidTimezone("Europe/Sofia")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    // A wrong timezone decides which calendar day a session counts as, so this
    // has to fail rather than quietly plan someone's day in UTC.
    expect(isValidTimezone("Europe/Sofa")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("parseProfileForm", () => {
  it("returns the update when everything is in order", () => {
    expect(parseProfileForm(form(valid))).toEqual({
      ok: true,
      update: {
        name: "Nikolay",
        handle: "nikolay",
        locale: "en",
        timezone: "Europe/Sofia",
      },
    });
  });

  it("trims the name and keeps an empty handle as null", () => {
    const result = parseProfileForm(form({ ...valid, name: "  Nikolay  ", handle: "" }));
    expect(result).toEqual({
      ok: true,
      update: { name: "Nikolay", handle: null, locale: "en", timezone: "Europe/Sofia" },
    });
  });

  it("refuses an empty name", () => {
    const result = parseProfileForm(form({ ...valid, name: "   " }));
    expect(result).toEqual({ ok: false, error: "Your name can't be empty." });
  });

  it("refuses an over-long name", () => {
    const result = parseProfileForm(
      form({ ...valid, name: "a".repeat(MAX_NAME_LENGTH + 1) }),
    );
    expect(result.ok).toBe(false);
  });

  it("passes the handle's own complaint straight through", () => {
    const result = parseProfileForm(form({ ...valid, handle: "no" }));
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("between 3 and 30"),
    });
  });

  it.each([["en"], ["de"], ["bg"], ["es"]])(
    "accepts %s, which we have copy for",
    (locale) => {
      const result = parseProfileForm(form({ ...valid, locale }));
      expect(result).toEqual({ ok: true, update: { ...valid, locale } });
    },
  );

  it.each([["English"], ["pt-BR"], ["en-GB"], ["fr"], [""]])(
    "refuses %s, which we don't",
    (locale) => {
      // Storing one of these buys a row whose only effect is to fall back to
      // English at send time — a preference recorded and then not honoured.
      expect(parseProfileForm(form({ ...valid, locale }))).toEqual({
        ok: false,
        error: "We don't speak that language yet.",
      });
    },
  );

  it("refuses a timezone the platform doesn't know", () => {
    const result = parseProfileForm(form({ ...valid, timezone: "Mars/Olympus" }));
    expect(result).toEqual({
      ok: false,
      error: "We don't recognise that timezone.",
    });
  });

  it("treats missing fields as empty rather than throwing", () => {
    // A form that 500s on a missing field is worse than one that says what it
    // wanted — and a POST that never came from our form is allowed to be
    // missing anything at all.
    expect(parseProfileForm(new FormData()).ok).toBe(false);

    // Name only: no handle (fine, that means none) and no language (not fine).
    expect(parseProfileForm(form({ name: "A" }))).toEqual({
      ok: false,
      error: "We don't speak that language yet.",
    });

    // Everything but the timezone.
    expect(parseProfileForm(form({ name: "A", locale: "en" }))).toEqual({
      ok: false,
      error: "We don't recognise that timezone.",
    });
  });
});
