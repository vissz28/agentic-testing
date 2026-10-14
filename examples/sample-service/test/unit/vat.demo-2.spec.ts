import { describe, expect, it } from 'vitest'
import { grossTotal, vatAmount } from '../../src/vat'

describe('DEMO-2 VAT amount rounds half a cent down instead of up', () => {
  it('half a cent rounds up', () => {
    const net = 0.25

    const vat = vatAmount(net, 22)

    expect(vat).toBe(0.06)
  })

  it('half a cent rounds up at the reduced rate', () => {
    const net = 10.25

    const vat = vatAmount(net, 10)

    expect(vat).toBe(1.03)
  })

  it('an amount with no half cent is unchanged', () => {
    const net = 12.50

    const vat = vatAmount(net, 22)

    expect(vat).toBe(2.75)
  })

  it('the gross total includes the rounded VAT', () => {
    const net = 0.25

    const gross = grossTotal(net, 22)

    expect(gross).toBe(0.31)
  })
})
