// Vietnamese search normalization (P2.23), same rule as the legacy demo
// searchText(): strip diacritics, đ/Đ -> d/D, lowercase. Stored searchText and
// queries go through this so "ao mua" matches "Áo mưa".
export function searchNormalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
