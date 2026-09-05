/** Applies the display rule: strip only a leading lower-case e before an upper-case letter, then split CamelCase. */
export function stationaryDisplayLabel(identifier: string): string {
  const segment = identifier.includes(".") ? identifier.split(".").at(-1)! : identifier;
  return segment
    .replace(/^e(?=[A-Z])/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

/** Action labels omit a terminal Group while headings retain it. */
export function stationaryActionLabel(identifier: string): string {
  return stationaryDisplayLabel(identifier).replace(/ Group$/, "");
}
