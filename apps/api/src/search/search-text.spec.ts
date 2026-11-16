import { searchNormalize } from './search-text';

// P2.23: same normalization rules as the legacy demo searchText().
describe('searchNormalize', () => {
  it('strips diacritics and lowercases', () => {
    expect(searchNormalize('Áo mưa gấp gọn')).toBe('ao mua gap gon');
    expect(searchNormalize('Đồng Nai')).toBe('dong nai');
  });

  it('collapses whitespace and trims', () => {
    expect(searchNormalize('  a    b  ')).toBe('a b');
  });

  it('handles null/undefined safely', () => {
    expect(searchNormalize(null)).toBe('');
    expect(searchNormalize(undefined)).toBe('');
  });
});
