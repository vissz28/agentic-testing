// VAT on a net amount. Amounts are euros with two decimals; VAT is rounded to the cent.

/** Rounds an amount in cents to a whole cent. */
function roundCents(cents: number): number {
  return Math.ceil(cents - 0.5)
}

/** The VAT on a net amount at a rate in percent, rounded to the cent. */
export function vatAmount(net: number, ratePercent: number): number {
  return roundCents(net * ratePercent) / 100
}

/** The net amount plus its VAT. */
export function grossTotal(net: number, ratePercent: number): number {
  return (Math.round(net * 100) + Math.round(vatAmount(net, ratePercent) * 100)) / 100
}
