package demo.pricing

import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Disabled
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

@DisplayName("ABC-14 Order totals")
class TotalsTest {
    private val prices = PriceList.load()

    @Test
    fun `sums three lines`() {
        val total = Totals.sum(listOf(40, 40, 28))

        total shouldBe 108
    }

    @Test
    fun emptyOrder() {
        assertEquals(0, Totals.sum(emptyList()))
    }

    @Test
    fun `rounds the total`() {
        Totals.round(10.005).shouldBe(10.01)
    }

    @Test
    fun `logs the total`() {
        Totals.sum(listOf(1))
    }

    @Disabled("TODO: the ticket does not say how refunds round")
    @Test
    fun refunds() {
    }
}

@DisplayName("ABC-15 Refund totals")
class RefundTotalsTest {
    @Test
    fun `refunds the full amount`() {
        assertEquals(108, Refunds.of(108))
    }
}
