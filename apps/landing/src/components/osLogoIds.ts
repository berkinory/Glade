// Counts rendered Linux marks across a build so each copy's gradient ids stay unique.
let count = 0;

export function nextOsLogoSuffix(name: string): string {
  count += 1;
  return `-${name}${count}`;
}
