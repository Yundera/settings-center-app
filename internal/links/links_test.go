package links

import "testing"

func TestBase(t *testing.T) {
	type want struct {
		base string
		dot  bool
	}
	for host, w := range map[string]want{
		"admin-alice.nsl.sh":     {"alice.nsl.sh", false},
		"ADMIN-alice.nsl.sh:443": {"alice.nsl.sh", false},
		"admin-1-2-3-4.sslip.io": {"1-2-3-4.sslip.io", false},
		"admin-1-2-3-4.nip.io":   {"1-2-3-4.nip.io", false},
		"admin.alice.nsl.sh":     {"alice.nsl.sh", true},
		"Admin.alice.nsl.sh:443": {"alice.nsl.sh", true},
		"admin.nsl":              {"fallback.nsl.sh", false},
		"admin.evil.com/x":       {"fallback.nsl.sh", false},
		"admin-app":              {"fallback.nsl.sh", false},
		"localhost:8080":         {"fallback.nsl.sh", false},
		"admin-evil.com/x":       {"fallback.nsl.sh", false},
		"admin-a b.com":          {"fallback.nsl.sh", false},
		"maison-alice.nsl.sh":    {"fallback.nsl.sh", false},
		"maison.alice.nsl.sh":    {"fallback.nsl.sh", false},
	} {
		if b, dot := Base(host, "fallback.nsl.sh"); b != w.base || dot != w.dot {
			t.Errorf("Base(%q) = %q, %v, want %q, %v", host, b, dot, w.base, w.dot)
		}
	}
}

func TestFor(t *testing.T) {
	l := For("alice.nsl.sh", false, "https://app.yundera.com/dashboard")
	if l.Maison != "https://maison-alice.nsl.sh" || l.MaisonBackups != "https://maison-alice.nsl.sh/settings/backups" ||
		l.Kopia != "https://kopia-alice.nsl.sh" || l.AuthAccess != "https://auth-console-alice.nsl.sh/access" ||
		l.MeshDomain != "https://mesh-console-alice.nsl.sh/domain" || l.Root != "https://alice.nsl.sh" {
		t.Fatalf("links = %+v", l)
	}
}

func TestForDot(t *testing.T) {
	l := For("alice.nsl.sh", true, "https://app.yundera.com/dashboard")
	if l.Maison != "https://maison.alice.nsl.sh" || l.Kopia != "https://kopia.alice.nsl.sh" ||
		l.AuthAccess != "https://auth-console.alice.nsl.sh/access" ||
		l.MeshDomain != "https://mesh-console.alice.nsl.sh/domain" || l.Root != "https://alice.nsl.sh" {
		t.Fatalf("links = %+v", l)
	}
}
