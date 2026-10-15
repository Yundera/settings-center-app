package envfile

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseLine(t *testing.T) {
	cases := []struct {
		in, k, v string
		ok       bool
	}{
		{"A=1", "A", "1", true},
		{"export B='two words'", "B", "two words", true},
		{`C="q"`, "C", "q", true},
		{"# x=1", "", "", false},
		{"", "", "", false},
		{"noequals", "", "", false},
		{"D=", "D", "", true},
		{"E=a=b", "E", "a=b", true},
	}
	for _, c := range cases {
		k, v, ok := ParseLine(c.in)
		if k != c.k || v != c.v || ok != c.ok {
			t.Errorf("ParseLine(%q) = %q,%q,%v want %q,%q,%v", c.in, k, v, ok, c.k, c.v, c.ok)
		}
	}
}

func TestLoadMissingIsEmpty(t *testing.T) {
	env, err := Load(filepath.Join(t.TempDir(), "nope"))
	if err != nil || len(env) != 0 {
		t.Fatalf("got %v, %v", env, err)
	}
}

func TestLoadAndGet(t *testing.T) {
	p := filepath.Join(t.TempDir(), ".pcs.env")
	_ = os.WriteFile(p, []byte("UPDATE_URL=\nTRUST_ISSUER=https://x/auth\n"), 0o600)
	env, err := Load(p)
	if err != nil {
		t.Fatal(err)
	}
	if env.Get("UPDATE_URL", "TRUST_ISSUER") != "https://x/auth" {
		t.Fatalf("Get fallback broken: %v", env)
	}
}
