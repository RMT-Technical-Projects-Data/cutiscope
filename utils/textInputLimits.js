export function applyCappedTextChange(previousValue, nextValue, maxLength, sanitize) {
  const previous = String(previousValue ?? '');
  const cleaned = sanitize(String(nextValue ?? ''));

  if (typeof maxLength === 'number' && maxLength >= 0) {
    if (previous.length >= maxLength && cleaned.length > previous.length) {
      return previous;
    }
    if (cleaned.length > maxLength) {
      return cleaned.slice(0, maxLength);
    }
  }

  return cleaned;
}
