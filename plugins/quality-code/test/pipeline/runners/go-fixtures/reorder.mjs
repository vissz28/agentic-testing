// A Go spec as the guide has it: a key block of literal scenarios (testify, an if, a todo) and a
// table-driven test. The runner and dialect tests share it.
export const REORDER = `package orders

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// ABC-12 Reorder below the threshold
func TestReorder(t *testing.T) {
	t.Run("stock of 4 reorders", func(t *testing.T) {
		got := Reorder(4)

		assert.Equal(t, 20, got)
	})

	t.Run("stock of 5 does not", func(t *testing.T) {
		if got := Reorder(5); got != 0 {
			t.Errorf("Reorder(5) = %d, want 0", got)
		}
	})

	t.Run("later", func(t *testing.T) {
		t.Skip("todo: the ticket does not say")
	})
}

func TestTable(t *testing.T) {
	cases := []struct {
		name string
		in   int
	}{{"zero", 0}, {"negative", -1}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if !Valid(tc.in) {
				t.Fatalf("not ok for %d", tc.in)
			}
		})
	}
}
`
