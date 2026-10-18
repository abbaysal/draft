/**
 * Identity matching helpers. Player names differ between sources in diacritics
 * ("Jokić" vs "Jokic"), suffixes ("Jr.", "III"), punctuation ("A.J." vs "AJ")
 * and nicknames. We normalise to a canonical key and keep a small alias table
 * for known variations.
 */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

const ALIASES: Record<string, string> = {
  // canonical key of alias -> canonical key of preferred name
  "nicolas claxton": "nic claxton",
  "lu dort": "luguentz dort",
  "kelel ware": "kelel ware",
  "herb jones": "herbert jones",
  "cam johnson": "cameron johnson",
  "moe wagner": "moritz wagner",
  "gg jackson": "gregory jackson",
  "jimmy butler": "jimmy butler",
};

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/đ/g, "d");
}

export function nameKey(name: string): string {
  const base = stripDiacritics(name)
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/-/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIXES.has(t))
    .join(" ");
  return ALIASES[base] ?? base;
}
