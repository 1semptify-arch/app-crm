// Match on a normalized name (case/punctuation/parenthetical-insensitive) so a
// seed rename like "Sen. Zaynab Mohamed (DFL)" -> "(DFL-63)" or a CSV import of
// "Doe,  Jane " refreshes the existing row instead of leaving a duplicate.
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
