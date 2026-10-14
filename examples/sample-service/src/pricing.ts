// Order pricing before VAT: line totals, the order subtotal and the volume discount.
// Amounts are net euros with two decimals; the arithmetic runs in whole cents.

export interface OrderLine {
  sku: string
  unitPrice: number
  quantity: number
}

export interface OrderTotal {
  subtotal: number
  discount: number
  total: number
}

/** Orders of this subtotal (in cents) or more get the volume discount. */
export const DISCOUNT_THRESHOLD_CENTS = 10000
/** The volume discount, in percent of the subtotal. */
export const DISCOUNT_PERCENT = 10

const toCents = (euros: number): number => Math.round(euros * 100)
const toEuros = (cents: number): number => cents / 100

function lineCents(line: OrderLine): number {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    throw new Error(`quantity must be a whole number of 1 or more, not ${line.quantity}`)
  }
  return toCents(line.unitPrice) * line.quantity
}

/** The net total of one line: unit price times quantity. */
export function lineTotal(line: OrderLine): number {
  return toEuros(lineCents(line))
}

/** Subtotal, volume discount and total of an order. */
export function orderTotal(lines: OrderLine[]): OrderTotal {
  const subtotal = lines.reduce((sum, line) => sum + lineCents(line), 0)
  const discount = subtotal >= DISCOUNT_THRESHOLD_CENTS ? Math.round((subtotal * DISCOUNT_PERCENT) / 100) : 0
  return { subtotal: toEuros(subtotal), discount: toEuros(discount), total: toEuros(subtotal - discount) }
}
