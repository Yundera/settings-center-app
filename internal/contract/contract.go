// Package contract compares JSON documents by shape, for the tests that pin
// the public API to what v1 served: the same keys at every level, and the
// same JSON type for every value (null matches anything — v1 had nulls where
// a fresh process does not, and the other way round).
package contract

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"
)

// SameShape fails t unless got has the same shape as want.
func SameShape(t testing.TB, want, got []byte) {
	t.Helper()
	var w, g any
	if err := json.Unmarshal(want, &w); err != nil {
		t.Fatalf("want is not JSON: %v", err)
	}
	if err := json.Unmarshal(got, &g); err != nil {
		t.Fatalf("got is not JSON: %v", err)
	}
	if diffs := Diff("$", w, g); len(diffs) > 0 {
		t.Fatalf("shape differs from v1:\n  %s\ngot: %s", strings.Join(diffs, "\n  "), got)
	}
}

// Diff lists where got's shape departs from want's. Object keys must match
// exactly; maps keyed by device or interface name are stripped by the caller.
func Diff(path string, want, got any) []string {
	if want == nil || got == nil {
		return nil
	}
	switch w := want.(type) {
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok {
			return []string{fmt.Sprintf("%s: want object, got %T", path, got)}
		}
		var out []string
		for _, k := range keys(w) {
			gv, ok := g[k]
			if !ok {
				out = append(out, fmt.Sprintf("%s.%s: missing", path, k))
				continue
			}
			out = append(out, Diff(path+"."+k, w[k], gv)...)
		}
		for _, k := range keys(g) {
			if _, ok := w[k]; !ok {
				out = append(out, fmt.Sprintf("%s.%s: not in v1", path, k))
			}
		}
		return out
	case []any:
		g, ok := got.([]any)
		if !ok {
			return []string{fmt.Sprintf("%s: want array, got %T", path, got)}
		}
		if len(w) == 0 || len(g) == 0 {
			return nil
		}
		return Diff(path+"[0]", w[0], g[0])
	default:
		if fmt.Sprintf("%T", want) != fmt.Sprintf("%T", got) {
			return []string{fmt.Sprintf("%s: want %T, got %T", path, want, got)}
		}
		return nil
	}
}

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
