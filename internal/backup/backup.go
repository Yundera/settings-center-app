// Package backup wraps the template's tools/backup.sh: whether this box's
// backups are on and in which state, switching them on or off, and the
// owner's encryption password — choosing the first one (init), giving back the
// old one after a rebuild (recover), or wiping the backup space to start over
// (reset). Every call answers the status JSON on stdout; failures carry an
// "ERROR: …" line, reduced here to a code the UI translates.
package backup

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/yundera/settings-center-app/internal/features"
	"github.com/yundera/settings-center-app/internal/hostrun"
	"github.com/yundera/settings-center-app/internal/hostverb"
)

// States backup.sh reports.
const (
	NeedsSecret   = "needs-secret"   // storage empty, no password yet: choose one (init)
	NeedsRecovery = "needs-recovery" // storage holds backups, no password: recover or reset
	Ready         = "ready"          // repository connected
	Disabled      = "disabled"       // BACKUP_ENABLED=false, the owner's choice
	Unavailable   = "unavailable"    // no credentials or a broken engine
)

type Status struct {
	Enabled bool   `json:"enabled"`
	State   string `json:"state"`
	Engine  string `json:"engine"`
	SpaceID string `json:"spaceId"`
}

// Settled reports a state that needs nothing from the owner.
func (s Status) Settled() bool { return s.State == Ready || s.State == Disabled }

type Service struct {
	Run   hostrun.Runner
	Paths func() hostverb.Paths
}

func (s Service) call(ctx context.Context, verb, password string) (Status, error) {
	spec, err := hostverb.Backup(s.Paths(), verb, password)
	if err != nil {
		return Status{}, err
	}
	res, err := s.Run.Run(ctx, spec)
	if err != nil {
		return Status{}, err
	}
	if err := res.Err(); err != nil {
		return Status{}, err
	}
	var out Status
	if err := hostrun.DecodeJSON(res.Stdout, &out); err != nil {
		return Status{}, fmt.Errorf("backup.sh: %w", err)
	}
	if out.State == "" {
		return Status{}, errors.New(`backup.sh returned no "state"`)
	}
	return out, nil
}

func (s Service) Status(ctx context.Context) (Status, error) { return s.call(ctx, "status", "") }

// Do runs one of hostverb.BackupVerbs; password only for init and recover.
func (s Service) Do(ctx context.Context, verb, password string) (Status, error) {
	return s.call(ctx, verb, password)
}

// Error codes for the UI (error_<code> in web/messages). backup.sh's ERROR
// line comes in two shapes: Maison's CLI code in brackets ("ERROR: … [wrong_key]")
// for init/recover, and the orchestrator's code leading it ("ERROR:
// CONFIRM_MISMATCH: …") for reset. Plain words are the fallback.
var maisonCodes = map[string]bool{"wrong_key": true, "repository_exists": true, "not_awaiting_secret": true, "too_short": true}

var orchestratorCodes = map[string]string{
	"CONFIRM_REQUIRED": "confirm_mismatch",
	"CONFIRM_MISMATCH": "confirm_mismatch",
	"RESET_RATE_LIMIT": "rate_limited",
	"NO_BACKUP_SPACE":  "no_backup_space",
	"UNREACHABLE":      "unreachable",
	"CONFLICT":         "reset_busy",
}

var (
	bracketRe = regexp.MustCompile(`\[([a-z_]+)\]`)
	leadRe    = regexp.MustCompile(`ERROR:\s*([A-Z][A-Z0-9_]+):`)
	words     = []struct {
		code string
		re   *regexp.Regexp
	}{
		{"wrong_key", regexp.MustCompile(`(?i)wrong_key|wrong (password|key)|incorrect (password|key)`)},
		{"repository_exists", regexp.MustCompile(`(?i)repository_exists|repository (already )?exists|found existing data`)},
		{"not_awaiting_secret", regexp.MustCompile(`(?i)not_awaiting_secret|not awaiting|only for a PCS whose backups need recovery`)},
		{"too_short", regexp.MustCompile(`(?i)too_short|at least 16`)},
		{"backup_disabled", regexp.MustCompile(`(?i)backups are disabled`)},
		{"rate_limited", regexp.MustCompile(`(?i)\b429\b|rate.?limit|too many resets`)},
	}
)

// Code reduces a backup.sh failure to an error code; "backup_failed" when it
// is none of the known ones.
func Code(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	for _, m := range bracketRe.FindAllStringSubmatch(msg, -1) {
		if maisonCodes[m[1]] {
			return m[1]
		}
	}
	if m := leadRe.FindStringSubmatch(msg); m != nil {
		if c, ok := orchestratorCodes[m[1]]; ok {
			return c
		}
	}
	for _, w := range words {
		if w.re.MatchString(msg) {
			return w.code
		}
	}
	return "backup_failed"
}

// Describe reduces a script failure to its "ERROR: …" line.
func Describe(err error) string { return features.Describe(err) }
