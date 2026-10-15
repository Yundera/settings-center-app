package status

import (
	"strings"
	"testing"
	"time"
)

func bp(b bool) *bool { return &b }

var now = time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)

func healthy() Inputs {
	return Inputs{
		Now:       now,
		SelfCheck: SelfCheck{Completed: bp(true), EndedAt: now.Add(-9 * time.Hour), Passed: 25, Total: 25},
		Updates:   Updates{Enabled: bp(true), Channel: "stable"},
		Identity:  Identity{AppliedAt: now.Add(-24 * time.Hour), TokenExpiry: now.Add(5 * 24 * time.Hour)},
		Storage:   Storage{Known: true, SizeBytes: 100, UsedBytes: 40, AvailBytes: 60},
		Support:   bp(false),
	}
}

func TestCompute(t *testing.T) {
	cases := []struct {
		name      string
		mod       func(*Inputs)
		level     Level
		tile      string
		tileCode  string
		issueCode string
	}{
		{"all good", func(*Inputs) {}, OK, "healthCheck", "health.ok", ""},
		{"support off is not a problem", func(*Inputs) {}, OK, "support", "support.off", ""},
		{"check failed", func(in *Inputs) { in.SelfCheck.Completed = bp(false); in.SelfCheck.Failed = []string{"a.sh"} }, Bad, "healthCheck", "health.failed", "health.failed"},
		{"check stale", func(in *Inputs) { in.SelfCheck.EndedAt = now.Add(-72 * time.Hour) }, Warn, "healthCheck", "health.stale", "health.stale"},
		{"first run", func(in *Inputs) { in.SelfCheck = SelfCheck{Running: true} }, OK, "healthCheck", "health.firstRun", ""},
		{"no run", func(in *Inputs) { in.SelfCheck = SelfCheck{} }, OK, "healthCheck", "health.noRun", ""},
		{"updates off", func(in *Inputs) { in.Updates.Enabled = bp(false) }, Warn, "updates", "updates.off", "updates.off"},
		{"frozen", func(in *Inputs) { in.Updates.Channel = "frozen" }, Warn, "updates", "updates.off", "updates.off"},
		{"local", func(in *Inputs) { in.Updates.Channel = "local" }, Warn, "updates", "updates.local", "updates.local"},
		{"main channel", func(in *Inputs) { in.Updates.Channel = "main" }, OK, "updates", "updates.onChannel", ""},
		{"token expiring", func(in *Inputs) { in.Identity.TokenExpiry = now.Add(10 * time.Hour) }, Warn, "connection", "connection.expiring", "connection.expiring"},
		{"token expired", func(in *Inputs) { in.Identity.TokenExpiry = now.Add(-time.Hour) }, Bad, "connection", "connection.expired", "connection.expired"},
		{"token unknown", func(in *Inputs) { in.Identity = Identity{} }, OK, "connection", "connection.unknown", ""},
		{"disk high", func(in *Inputs) { in.Storage.UsedBytes = 90 }, Warn, "storage", "storage.high", "storage.high"},
		{"disk full", func(in *Inputs) { in.Storage.UsedBytes = 97 }, Bad, "storage", "storage.full", "storage.full"},
		{"disk unknown", func(in *Inputs) { in.Storage = Storage{} }, OK, "storage", "storage.unknown", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := healthy()
			c.mod(&in)
			s := Compute(in)
			if s.Level != c.level {
				t.Errorf("level = %s, want %s", s.Level, c.level)
			}
			if got := s.Tiles[c.tile].Code; got != c.tileCode {
				t.Errorf("tile %s = %s, want %s", c.tile, got, c.tileCode)
			}
			if c.issueCode == "" && len(s.Issues) != 0 {
				t.Errorf("unexpected issues %+v", s.Issues)
			}
			if c.issueCode != "" && (len(s.Issues) != 1 || s.Issues[0].Code != c.issueCode) {
				t.Errorf("issues = %+v, want %s", s.Issues, c.issueCode)
			}
			if len(s.Tiles) != 5 {
				t.Errorf("tiles = %d", len(s.Tiles))
			}
		})
	}
}

func TestChannel(t *testing.T) {
	for in, want := range map[string]string{
		"":       "stable",
		"local":  "local",
		"frozen": "frozen",
		"https://github.com/Yundera/template-root/archive/refs/heads/main.zip":   "main",
		"https://github.com/Yundera/template-root/archive/refs/heads/stable.zip": "stable",
		"https://example.com/fork.zip":                                           "custom",
	} {
		if got := Channel(in); got != want {
			t.Errorf("Channel(%q) = %s, want %s", in, got, want)
		}
	}
}

// Issue pages are SPA paths behind the AppShield gate, which answers some
// paths itself before proxying (/health, /login, /nhl-auth/, /AppShield/,
// /.well-known/). A link there would land on the gate, not the page.
func TestIssuePagesAvoidGateRoutes(t *testing.T) {
	in := healthy()
	in.SelfCheck.Completed = bp(false)
	in.Updates.Enabled = bp(false)
	in.Identity.TokenExpiry = now.Add(-time.Hour)
	in.Storage.UsedBytes = 99
	for _, is := range Compute(in).Issues {
		p := is.Page
		if p == "/health" || p == "/login" || strings.HasPrefix(p, "/login/") || strings.HasPrefix(p, "/nhl-auth/") ||
			strings.HasPrefix(p, "/AppShield/") || strings.HasPrefix(p, "/.well-known/") {
			t.Errorf("issue %s links to %s, a path the gate answers itself", is.Code, p)
		}
	}
}
