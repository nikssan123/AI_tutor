import { describe, expect, it } from "vitest";
import { LOCALES } from "@/lib/i18n/locales";
import {
  missingVariables,
  renderOperatorMessage,
  TEMPLATE_IDS,
  TEMPLATES,
  templateById,
  threadSubjectFor,
} from "@/lib/email/catalog";

/**
 * The templates a person sends.
 *
 * The property worth pinning hardest: **an operator cannot send a message with
 * a hole in it**. Every one of these goes to somebody who did not ask for it,
 * or to somebody waiting on an answer, and "Hi , you asked for " is worse than
 * silence in both cases.
 */

const ENV = { NEXT_PUBLIC_SITE_URL: "https://meritkeep.com" };

describe("the catalog", () => {
  it("has an entry for every declared id, and no others", () => {
    expect(TEMPLATES.map((template) => template.id).sort()).toEqual(
      [...TEMPLATE_IDS].sort(),
    );
  });

  it.each(TEMPLATE_IDS)("finds %s by id", (id) => {
    expect(templateById(id)?.id).toBe(id);
  });

  it("returns nothing for an id it does not have", () => {
    expect(templateById("nope")).toBeUndefined();
  });

  it("asks for a name in every template", () => {
    // Every one of these opens by greeting someone.
    for (const template of TEMPLATES) {
      expect(template.variables.map((v) => v.name)).toContain("name");
    }
  });

  it("only lets the support templates reply in a thread", () => {
    for (const template of TEMPLATES) {
      expect({ [template.id]: template.repliesInThread }).toEqual({
        [template.id]: template.kind === "support",
      });
    }
  });
});

describe("missingVariables", () => {
  const reply = templateById("reply")!;

  it("names every blank field", () => {
    expect(missingVariables(reply, {})).toEqual(["name", "message"]);
  });

  it("counts whitespace as blank", () => {
    expect(missingVariables(reply, { name: "  ", message: "hi" })).toEqual([
      "name",
    ]);
  });

  it("is empty when everything is filled", () => {
    expect(missingVariables(reply, { name: "Ana", message: "hi" })).toEqual([]);
  });
});

describe("renderOperatorMessage", () => {
  const welcome = templateById("welcome")!;

  it("fills the copy and signs it with the operator", () => {
    const message = renderOperatorMessage({
      template: welcome,
      to: "ana@x.co",
      locale: "en",
      variables: { name: "Ana" },
      sender: "Nikolay",
      env: ENV,
    });

    expect(message.subject).toBe("Welcome to MeritKeep, Ana");
    expect(message.text).toContain("Hi Ana");
    expect(message.text).toContain("— Nikolay");
  });

  it("points its button at the canonical site origin", () => {
    const message = renderOperatorMessage({
      template: welcome,
      to: "ana@x.co",
      locale: "en",
      variables: { name: "Ana" },
      sender: "N",
      env: ENV,
    });

    expect(message.text).toContain("https://meritkeep.com/today");
  });

  it("renders no button at all for a support reply", () => {
    // A reply that ends in a call to action is selling rather than answering.
    const message = renderOperatorMessage({
      template: templateById("reply")!,
      to: "ana@x.co",
      locale: "en",
      variables: { name: "Ana", message: "Fixed it." },
      sender: "N",
      threadSubject: "Broken login",
      env: ENV,
    });

    expect(message.subject).toBe("Re: Broken login");
    expect(message.html).not.toContain("<a ");
    expect(message.text).toContain("Fixed it.");
  });

  it("carries the operator's line breaks into both bodies", () => {
    const message = renderOperatorMessage({
      template: templateById("reply")!,
      to: "ana@x.co",
      locale: "en",
      variables: { name: "Ana", message: "One.\n\nTwo." },
      sender: "N",
      threadSubject: "S",
      env: ENV,
    });

    expect(message.text).toContain("One.\n\nTwo.");
    expect(message.html).toContain("One.");
    expect(message.html).toContain("Two.");
  });

  it("escapes what the operator typed", () => {
    // The operator is trusted; the copy-paste from a bug report they are
    // quoting back is not.
    const message = renderOperatorMessage({
      template: templateById("reply")!,
      to: "ana@x.co",
      locale: "en",
      variables: { name: "Ana", message: "<script>alert(1)</script>" },
      sender: "N",
      threadSubject: "S",
      env: ENV,
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
  });

  it("passes the envelope fields through", () => {
    const message = renderOperatorMessage({
      template: welcome,
      to: "ana@x.co",
      locale: "en",
      variables: { name: "Ana" },
      sender: "N",
      from: "MeritKeep <support@meritkeep.com>",
      replyTo: "support+t1@meritkeep.com",
      headers: { "In-Reply-To": "<a@b>" },
      env: ENV,
    });

    expect(message.from).toBe("MeritKeep <support@meritkeep.com>");
    expect(message.replyTo).toBe("support+t1@meritkeep.com");
    expect(message.headers).toEqual({ "In-Reply-To": "<a@b>" });
  });

  it.each(LOCALES)("writes to a %s reader in their language", (locale) => {
    const message = renderOperatorMessage({
      template: welcome,
      to: "ana@x.co",
      locale,
      variables: { name: "Ana" },
      sender: "N",
      env: ENV,
    });

    expect(message.html).toContain(`<html lang="${locale}">`);
    expect(message.subject).toContain("Ana");
    // No `{token}` may survive into a sent message.
    expect(message.text).not.toMatch(/\{\w+\}/);
  });

  it.each(TEMPLATE_IDS)("leaves no placeholder unfilled in %s", (id) => {
    const template = templateById(id)!;
    const variables = Object.fromEntries(
      template.variables.map((variable) => [variable.name, "x"]),
    );

    const message = renderOperatorMessage({
      template,
      to: "ana@x.co",
      locale: "en",
      variables,
      sender: "N",
      threadSubject: "S",
      env: ENV,
    });

    expect(message.text).not.toMatch(/\{\w+\}/);
    expect(message.subject).not.toMatch(/\{\w+\}/);
  });
});

describe("threadSubjectFor", () => {
  it("is the subject the message will actually carry", () => {
    expect(
      threadSubjectFor(templateById("packReady")!, { topic: "SQL" }),
    ).toBe("SQL is ready on MeritKeep");
  });

  it("files the thread under the reader's language", () => {
    expect(
      threadSubjectFor(templateById("checkIn")!, { goal: "SQL" }, "de"),
    ).toBe("Wie läuft es mit SQL?");
  });
});
