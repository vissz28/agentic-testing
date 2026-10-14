import { describe, expect, it } from 'vitest'
import { lineTotal, orderTotal } from '../../src/pricing'

describe('DEMO-1 Order total applies a 10% volume discount from 100.00', () => {
  it('line total', () => {
    const line = { sku: 'A-1', unitPrice: 4.50, quantity: 3 }

    const total = lineTotal(line)

    expect(total).toBe(13.50)
  })

  it('order below the discount threshold', () => {
    const lines = [
      { sku: 'A-1', unitPrice: 4.50, quantity: 3 },
      { sku: 'B-2', unitPrice: 20.00, quantity: 2 },
    ]

    const order = orderTotal(lines)

    expect(order.discount).toBe(0.00)
    expect(order.total).toBe(53.50)
  })

  it('order just below the discount threshold', () => {
    const lines = [{ sku: 'C-3', unitPrice: 33.33, quantity: 3 }]

    const order = orderTotal(lines)

    expect(order.discount).toBe(0.00)
    expect(order.total).toBe(99.99)
  })

  it('order exactly at the discount threshold', () => {
    const lines = [{ sku: 'D-4', unitPrice: 25.00, quantity: 4 }]

    const order = orderTotal(lines)

    expect(order.discount).toBe(10.00)
    expect(order.total).toBe(90.00)
  })

  it('order above the discount threshold', () => {
    const lines = [
      { sku: 'E-5', unitPrice: 60.00, quantity: 1 },
      { sku: 'F-6', unitPrice: 12.50, quantity: 4 },
    ]

    const order = orderTotal(lines)

    expect(order).toEqual({ subtotal: 110.00, discount: 11.00, total: 99.00 })
  })

  it('quantity of zero', () => {
    const line = { sku: 'A-1', unitPrice: 4.50, quantity: 0 }

    const act = () => lineTotal(line)

    expect(act).toThrow('quantity must be a whole number of 1 or more, not 0')
  })
})
