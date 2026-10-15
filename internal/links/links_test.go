package links

import "testing"

func TestBase(t *testing.T) {
	for host, want := range map[string]string{
		"admin-alice.nsl.sh":     "alice.nsl.sh",
		"ADMIN-alice.nsl.sh:443": "alice.nsl.sh",
		"admin-1-2-3-4.sslip.io": "1-2-3-4.sslip.io",
		"admin-1-2-3-4.nip.io":   "1-2-3-4.nip.io",
		"admin-app":              "fallback.nsl.sh",
		"localhost:8080":         "fallback.nsl.sh",
		"admin-evil.com/x":       "fallback.nsl.sh",
		"admin-a b.com":          "fallback.nsl.sh",
		"maison-alice.nsl.sh":    "fallback.nsl.sh",
	} {
		if got := Base(host, "fallback.nsl.sh"); got != want {
			t.Errorf("Base(%q) = %q, want %q", host, got, want)
		}
	}
}

func TestFor(t *testing.T) {
	l := For("alice.nsl.sh", "https://app.yundera.com/dashboard")
	if l.Maison != "https://maison-alice.nsl.sh" || l.MaisonBackups != "https://maison-alice.nsl.sh/settings/backups" ||
		l.Kopia != "https://kopia-alice.nsl.sh" || l.AuthAccess != "https://auth-console-alice.nsl.sh/access" ||
		l.MeshDomain != "https://mesh-console-alice.nsl.sh/domain" || l.Root != "https://alice.nsl.sh" {
		t.Fatalf("links = %+v", l)
	}
}
