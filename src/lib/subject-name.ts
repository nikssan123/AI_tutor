/**
 * A subject's name, as it should read *inside* a sentence.
 *
 * Pack names are written as titles — "Photography", "SQL & Data Analysis",
 * "Business Writing & Communication" — and three separate bits of copy drop one
 * into the middle of a sentence: two meta descriptions, the `Quiz` markup, and
 * the goal title a learner is given when they do not write their own.
 *
 * All three used to call `.toLowerCase()`, which is right for two of the three
 * packs that exist and mangles the third into "sql & data analysis" — in a
 * search result, in structured data, and in the learner's own goal. Not
 * lowercasing at all is wrong the other way: "Get good at Photography" is a
 * title pasted into a sentence.
 *
 * So it is decided per word rather than per name: an all-capital word is an
 * acronym and is left exactly as it is; everything else is ordinary title case
 * and comes down. That is the distinction the writer of the pack was making by
 * capitalising it in the first place.
 */
export function subjectInProse(name: string): string {
  return name
    .split(" ")
    .map((word) => (isAcronym(word) ? word : word.toLowerCase()))
    .join(" ");
}

/**
 * Two or more letters, all capital. The length floor keeps "A" and the "&" in
 * "SQL & Data Analysis" out of it — a one-character token carries no signal
 * about whether it was capitalised deliberately.
 */
function isAcronym(word: string): boolean {
  const letters = word.replace(/[^A-Za-z]/g, "");
  return letters.length >= 2 && letters === letters.toUpperCase();
}
