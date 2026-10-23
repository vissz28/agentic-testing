package demo.pricing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

@DisplayName("ABC-12 Line totals round to the cent")
class LineTotalTest {

  @Test
  @DisplayName("three at 4.50 make 13.50")
  void threeItems() {
    assertEquals(1350, LineTotal.cents(3, 450));
  }

  @Test
  @DisplayName("half a cent \"rounds\" up & away")
  void roundsHalfUp() {
    assertThat(LineTotal.cents(1, 1000.5)).isEqualTo(1001);
  }

  @Test
  void parsesSku() {
    // assertEquals("B-2", ...) was the old code
    assertEquals("A-1", Sku.parse("A-1/3").code());
  }

  @Disabled("ABC-9 the discount rule is not decided")
  @Test
  void discount() {
    assertTrue(LineTotal.discounted(100));
  }

  @ParameterizedTest
  @ValueSource(ints = {1, 2})
  void quantities(int n) {
    assertTrue(LineTotal.cents(n, 100) > 0);
  }

  @Nested
  class WhenEmpty {
    @Test
    void zero() {
      assertEquals(0, LineTotal.cents(0, 450));
    }
  }
}
