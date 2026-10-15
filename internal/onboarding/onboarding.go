// Package onboarding wraps the template's tools/onboarding.sh: whether the box
// has been claimed (an owner account exists), claiming it, marking the welcome
// done, and resetting it back to unclaimed. Every call answers JSON on stdout.
package onboarding

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/yundera/settings-center-app/internal/features"
	"github.com/yundera/settings-center-app/internal/hostrun"
	"github.com/yundera/settings-center-app/internal/hostverb"
)

type Status struct {
	Claimed   bool   `json:"claimed"`
	Completed bool   `json:"completed"`
	Username  string `json:"username"`
}

type Result struct {
	Username  string `json:"username"`
	Claimed   bool   `json:"claimed"`
	Completed bool   `json:"completed"`
	// Password is set only when the script generated one; shown once.
	Password string `json:"password,omitempty"`
}

type ResetResult struct {
	Claimed   bool   `json:"claimed"`
	Completed bool   `json:"completed"`
	Username  string `json:"username"`
	Backup    string `json:"backup"`
}

type Service struct {
	Run   hostrun.Runner
	Paths func() hostverb.Paths
}

func run[T any](ctx context.Context, r hostrun.Runner, spec hostrun.Spec) (T, error) {
	var out T
	res, err := r.Run(ctx, spec)
	if err != nil {
		return out, err
	}
	if err := res.Err(); err != nil {
		return out, err
	}
	if err := hostrun.DecodeJSON(res.Stdout, &out); err != nil {
		return out, fmt.Errorf("onboarding.sh: %w", err)
	}
	return out, nil
}

func (s Service) Status(ctx context.Context) (Status, error) {
	spec, err := hostverb.Onboarding(s.Paths(), "status")
	if err != nil {
		return Status{}, err
	}
	return run[Status](ctx, s.Run, spec)
}

func (s Service) Claim(ctx context.Context, username, displayname, password string, generate bool) (Result, error) {
	spec, err := hostverb.OnboardingRun(s.Paths(), username, strings.TrimSpace(displayname), password, generate)
	if err != nil {
		return Result{}, err
	}
	return run[Result](ctx, s.Run, spec)
}

func (s Service) MarkCompleted(ctx context.Context) error {
	spec, err := hostverb.Onboarding(s.Paths(), "mark-completed")
	if err != nil {
		return err
	}
	_, err = run[map[string]any](ctx, s.Run, spec)
	return err
}

func (s Service) Reset(ctx context.Context) (ResetResult, error) {
	spec, err := hostverb.Onboarding(s.Paths(), "reset", "--confirm")
	if err != nil {
		return ResetResult{}, err
	}
	return run[ResetResult](ctx, s.Run, spec)
}

var alreadyRe = regexp.MustCompile(`(?i)already onboarded|already claimed`)

// IsAlreadyClaimed reports a claim refused because the box has an owner.
func IsAlreadyClaimed(err error) bool { return err != nil && alreadyRe.MatchString(err.Error()) }

// Describe reduces a script failure to its "ERROR: …" line.
func Describe(err error) string { return features.Describe(err) }
