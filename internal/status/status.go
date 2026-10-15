// Package status turns the evidence the Overview gathers into a verdict for a
// non-technical owner. Pure: no I/O, so every rule is a table test.
//
// It never returns prose. Every tile and issue carries a stable code plus
// params; the UI owns the words, in every language (web/messages/*.json).
// Same pattern as mesh-console's internal/status, with i18n keys in place of
// English sentences.
package status

import (
	"strings"
	"time"
)

type Level string

const (
	OK      Level = "ok"
	Info    Level = "info"
	Warn    Level = "warn"
	Bad     Level = "bad"
	Unknown Level = "unknown"
)

var rank = map[Level]int{Unknown: 0, OK: 1, Info: 2, Warn: 3, Bad: 4}

// worse returns the more severe of a and b. Unknown never makes it worse: a
// signal we could not read is not a problem with the box.
func worse(a, b Level) Level {
	if rank[b] > rank[a] {
		return b
	}
	return a
}

// Tile is one Overview card: code names the message, params fill it.
type Tile struct {
	Level  Level          `json:"level"`
	Code   string         `json:"code"`
	Params map[string]any `json:"params,omitempty"`
}

// Issue is one line in "What needs attention"; Page is where to fix it.
type Issue struct {
	Level  Level          `json:"level"`
	Code   string         `json:"code"`
	Page   string         `json:"page"`
	Params map[string]any `json:"params,omitempty"`
}

type Summary struct {
	Level  Level           `json:"level"`
	Tiles  map[string]Tile `json:"tiles"`
	Issues []Issue         `json:"issues"`
}

type SelfCheck struct {
	// Running: a run has started and not completed.
	Running bool
	// Last completed run: nil when none is in the log tail.
	Completed *bool // true = success
	EndedAt   time.Time
	Passed    int
	Total     int
	Failed    []string // names of failed scripts
}

type Updates struct {
	Enabled *bool  // platform-updates feature; nil = unknown
	Channel string // stable | main | local | frozen | custom
	// SyncedAt is when the template last synced (template/.revision.json).
	SyncedAt time.Time
}

type Identity struct {
	// AppliedAt is the last pushed identity (identity-state.json); zero = none.
	AppliedAt time.Time
	// TokenExpiry is USER_JWT's exp; zero = unknown.
	TokenExpiry time.Time
}

type Storage struct {
	Known      bool
	SizeBytes  int64
	UsedBytes  int64
	AvailBytes int64
}

type Inputs struct {
	Now       time.Time
	SelfCheck SelfCheck
	Updates   Updates
	Identity  Identity
	Storage   Storage
	// Support: the support-key feature (Yundera may sign in to help); nil = unknown.
	Support *bool
}

// StaleSelfCheck: the nightly check should have run within this.
const StaleSelfCheck = 50 * time.Hour

// Storage thresholds, as a fraction of the filesystem used.
const (
	storageWarn = 0.85
	storageBad  = 0.95
)

func Compute(in Inputs) Summary {
	s := Summary{Level: OK, Tiles: map[string]Tile{}, Issues: []Issue{}}
	add := func(name string, t Tile, issue *Issue) {
		s.Tiles[name] = t
		s.Level = worse(s.Level, t.Level)
		if issue != nil {
			s.Issues = append(s.Issues, *issue)
		}
	}

	// Health check.
	sc := in.SelfCheck
	switch {
	case sc.Completed == nil && sc.Running:
		add("healthCheck", Tile{Level: Info, Code: "health.firstRun"}, nil)
	case sc.Completed == nil:
		add("healthCheck", Tile{Level: Unknown, Code: "health.noRun"}, nil)
	case !*sc.Completed:
		p := map[string]any{"passed": sc.Passed, "total": sc.Total, "failed": strings.Join(sc.Failed, ", "), "at": sc.EndedAt}
		add("healthCheck", Tile{Level: Bad, Code: "health.failed", Params: p},
			&Issue{Level: Bad, Code: "health.failed", Page: "/health", Params: p})
	case in.Now.Sub(sc.EndedAt) > StaleSelfCheck:
		p := map[string]any{"at": sc.EndedAt}
		add("healthCheck", Tile{Level: Warn, Code: "health.stale", Params: p},
			&Issue{Level: Warn, Code: "health.stale", Page: "/health", Params: p})
	default:
		code := "health.ok"
		if sc.Running {
			code = "health.okRunning"
		}
		add("healthCheck", Tile{Level: OK, Code: code, Params: map[string]any{"passed": sc.Passed, "total": sc.Total, "at": sc.EndedAt}}, nil)
	}

	// Platform updates.
	u := in.Updates
	up := map[string]any{"channel": u.Channel}
	if !u.SyncedAt.IsZero() {
		up["at"] = u.SyncedAt
	}
	switch {
	case u.Channel == "frozen" || (u.Enabled != nil && !*u.Enabled):
		add("updates", Tile{Level: Warn, Code: "updates.off", Params: up},
			&Issue{Level: Warn, Code: "updates.off", Page: "/features"})
	case u.Channel == "local":
		add("updates", Tile{Level: Warn, Code: "updates.local", Params: up},
			&Issue{Level: Warn, Code: "updates.local", Page: "/features"})
	case u.Enabled == nil:
		add("updates", Tile{Level: Unknown, Code: "updates.unknown", Params: up}, nil)
	case u.Channel == "stable":
		add("updates", Tile{Level: OK, Code: "updates.on", Params: up}, nil)
	default:
		add("updates", Tile{Level: Info, Code: "updates.onChannel", Params: up}, nil)
	}

	// Connection to Yundera: the pushed identity and its token.
	id := in.Identity
	switch {
	case !id.TokenExpiry.IsZero() && !in.Now.Before(id.TokenExpiry):
		p := map[string]any{"at": id.TokenExpiry}
		add("connection", Tile{Level: Bad, Code: "connection.expired", Params: p},
			&Issue{Level: Bad, Code: "connection.expired", Page: "/support", Params: p})
	case !id.TokenExpiry.IsZero() && id.TokenExpiry.Sub(in.Now) < 48*time.Hour:
		p := map[string]any{"at": id.TokenExpiry}
		add("connection", Tile{Level: Warn, Code: "connection.expiring", Params: p},
			&Issue{Level: Warn, Code: "connection.expiring", Page: "/support", Params: p})
	case !id.TokenExpiry.IsZero():
		p := map[string]any{"until": id.TokenExpiry}
		if !id.AppliedAt.IsZero() {
			p["at"] = id.AppliedAt
		}
		add("connection", Tile{Level: OK, Code: "connection.ok", Params: p}, nil)
	default:
		add("connection", Tile{Level: Unknown, Code: "connection.unknown"}, nil)
	}

	// Storage.
	st := in.Storage
	if !st.Known || st.SizeBytes <= 0 {
		add("storage", Tile{Level: Unknown, Code: "storage.unknown"}, nil)
	} else {
		frac := float64(st.UsedBytes) / float64(st.SizeBytes)
		p := map[string]any{"used": st.UsedBytes, "size": st.SizeBytes, "avail": st.AvailBytes, "percent": int(frac*100 + 0.5)}
		switch {
		case frac >= storageBad:
			add("storage", Tile{Level: Bad, Code: "storage.full", Params: p},
				&Issue{Level: Bad, Code: "storage.full", Page: "/tools", Params: p})
		case frac >= storageWarn:
			add("storage", Tile{Level: Warn, Code: "storage.high", Params: p},
				&Issue{Level: Warn, Code: "storage.high", Page: "/tools", Params: p})
		default:
			add("storage", Tile{Level: OK, Code: "storage.ok", Params: p}, nil)
		}
	}

	// Support access: neither on nor off is a problem — it is the owner's call.
	switch {
	case in.Support == nil:
		add("support", Tile{Level: Unknown, Code: "support.unknown"}, nil)
	case *in.Support:
		add("support", Tile{Level: OK, Code: "support.on"}, nil)
	default:
		add("support", Tile{Level: Info, Code: "support.off"}, nil)
	}

	if s.Level == Info {
		s.Level = OK // informational tiles never change the headline
	}
	return s
}

// Channel names an UPDATE_URL value.
func Channel(updateURL string) string {
	v := strings.TrimSpace(updateURL)
	switch {
	case v == "":
		return "stable"
	case v == "local", v == "frozen":
		return v
	case strings.HasSuffix(v, "/Yundera/template-root/archive/refs/heads/main.zip"):
		return "main"
	case strings.HasSuffix(v, "/Yundera/template-root/archive/refs/heads/stable.zip"):
		return "stable"
	}
	return "custom"
}
