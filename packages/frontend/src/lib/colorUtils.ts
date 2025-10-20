const DEFAULT_NODE_COLOR = '#E5E7EB';

const HEX_REGEX = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

function normalizeHex(input?: string | null): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!HEX_REGEX.test(trimmed)) return null;
  let hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((char) => char + char)
      .join('');
  }
  return `#${hex.toLowerCase()}`;
}

export function getNodeColor(color?: string | null): string {
  return normalizeHex(color) ?? DEFAULT_NODE_COLOR;
}

export function hexToRgba(color: string, alpha = 1): string {
  const hex = normalizeHex(color) ?? DEFAULT_NODE_COLOR;
  const normalizedAlpha = Math.max(0, Math.min(1, alpha));
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
}

export function withAlpha(color: string | undefined | null, alpha: number): string {
  return hexToRgba(getNodeColor(color), alpha);
}

export { DEFAULT_NODE_COLOR };
