// Package features drives the Yundera features a box owner may switch off,
// through the template's tools/feature-*.sh (status|enable|disable, each
// answering {"id","enabled"} on stdout). All state lives in those scripts and
// .pcs.env; nothing is kept here. Port of v1's backend/server/Features and the
// disable guards of pages/api/admin/features.ts.
package features

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/yundera/settings-center-app/internal/hostrun"
	"github.com/yundera/settings-center-app/internal/hostverb"
)

type State struct {
	ID      string `json:"id"`
	Enabled *bool  `json:"enabled"`
	Error   string `json:"error,omitempty"`
}

type Service struct {
	Run   hostrun.Runner
	Paths func() hostverb.Paths
}

func (s Service) call(ctx context.Context, id, action string) (bool, error) {
	spec, err := hostverb.Feature(s.Paths(), id, action)
	if err != nil {
		return false, err
	}
	res, err := s.Run.Run(ctx, spec)
	if err != nil {
		return false, err
	}
	if err := res.Err(); err != nil {
		return false, err
	}
	script := hostverb.FeatureScripts[id]
	var out struct {
		Enabled *bool `json:"enabled"`
	}
	if err := hostrun.DecodeJSON(res.Stdout, &out); err != nil {
		return false, fmt.Errorf("%s: %w", script, err)
	}
	if out.Enabled == nil {
		return false, fmt.Errorf(`%s returned no "enabled" field`, script)
	}
	return *out.Enabled, nil
}

// Get is one feature's state.
func (s Service) Get(ctx context.Context, id string) (bool, error) { return s.call(ctx, id, "status") }

// All reads every feature in parallel; a failure is that feature's error, not
// the whole page's.
func (s Service) All(ctx context.Context) []State {
	out := make([]State, len(hostverb.FeatureIDs))
	var wg sync.WaitGroup
	for i, id := range hostverb.FeatureIDs {
		wg.Add(1)
		go func(i int, id string) {
			defer wg.Done()
			on, err := s.Get(ctx, id)
			out[i] = State{ID: id}
			if err != nil {
				out[i].Error = Describe(err)
			} else {
				out[i].Enabled = &on
			}
		}(i, id)
	}
	wg.Wait()
	return out
}

func (s Service) Set(ctx context.Context, id string, enabled bool) (State, error) {
	action := "disable"
	if enabled {
		action = "enable"
	}
	on, err := s.call(ctx, id, action)
	if err != nil {
		return State{}, err
	}
	return State{ID: id, Enabled: &on}, nil
}

var errorLineRe = regexp.MustCompile(`ERROR:\s*(.+?)(?:\n|$)`)

// Describe reduces a script failure to its "ERROR: …" line when it has one.
func Describe(err error) string {
	if err == nil {
		return ""
	}
	if m := errorLineRe.FindStringSubmatch(err.Error()); m != nil {
		return strings.TrimSpace(m[1])
	}
	return err.Error()
}

// Guard codes: why turning a feature off is refused. The UI explains them.
const (
	GuardLoginOnlyWayIn   = "login-only-way-in"
	GuardSupportLastWayIn = "support-last-way-in"
)

// ErrGuard carries a guard code.
type ErrGuard struct{ Code string }

func (e ErrGuard) Error() string {
	switch e.Code {
	case GuardLoginOnlyWayIn:
		return "This server has no local account yet, so Yundera Login is the only way to sign in. Create a local account first."
	case GuardSupportLastWayIn:
		return "This server has no local account and Yundera Login is already off, so the support key is the only remaining way in."
	}
	return e.Code
}

// CheckDisable refuses switching off what would lock the owner out. claimed
// is whether the box has a local account (onboarding).
func (s Service) CheckDisable(ctx context.Context, id string, claimed bool) error {
	if claimed || (id != "yundera-login" && id != "support-key") {
		return nil
	}
	if id == "yundera-login" {
		return ErrGuard{GuardLoginOnlyWayIn}
	}
	on, err := s.Get(ctx, "yundera-login")
	if err != nil {
		on = true // unknown: do not block on a read failure
	}
	if !on {
		return ErrGuard{GuardSupportLastWayIn}
	}
	return nil
}

// IsGuard reports whether err is a guard refusal.
func IsGuard(err error) (ErrGuard, bool) {
	var g ErrGuard
	ok := errors.As(err, &g)
	return g, ok
}
