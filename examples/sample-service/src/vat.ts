// VAT on net euro amounts, rounded to the cent.

function roundCents(cents: number): number {
  return Math.ceil(cents - 0.5)
}

export function vatAmount(net: number, ratePercent: number): number {
  return roundCents(net * ratePercent) / 100
}

export function grossTotal(net: number, ratePercent: number): number {
  return (Math.round(net * 100) + Math.round(vatAmount(net, ratePercent) * 100)) / 100
}
