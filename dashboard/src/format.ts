// Money for executives (SPEC 6): under $1M as $K (e.g. $992K), $1M and over
// as $M with two decimals (e.g. $13.18M). Rounded half up.

const MINUS = "−"; // typographic minus, easier to read than a hyphen

export function money(value: number): string {
  return (value < 0 ? MINUS : "") + magnitude(Math.abs(value));
}

export function signedMoney(value: number): string {
  if (value === 0) return "$0";
  return (value > 0 ? "+" : MINUS) + magnitude(Math.abs(value));
}

export function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function magnitude(amount: number): string {
  if (amount === 0) return "$0";
  const thousands = Math.round(amount / 1_000);
  if (thousands < 1_000) return `$${thousands}K`;
  const hundredthsOfMillion = Math.round(amount / 10_000);
  return `$${(hundredthsOfMillion / 100).toFixed(2)}M`;
}
