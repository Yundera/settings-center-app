// Package support is Yundera support's way into this box: the support SSH
// public key (served by the control plane), whether it sits in the admin
// user's authorized_keys, granting / revoking it, and the opt-out flag
// ENSURE_SUPPORT_KEY the nightly self-check honours. Port of v1's
// backend/server/Support.
package support

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/yundera/settings-center-app/internal/hostrun"
	"github.com/yundera/settings-center-app/internal/hostverb"
)

// User is the host account support logs into.
const User = "admin"

type Key struct {
	Algorithm   string `json:"algorithm"`
	Comment     string `json:"comment"`
	PublicKey   string `json:"publicKey"`
	Fingerprint string `json:"fingerprint"`
}

type Service struct {
	Run         hostrun.Runner
	OperatorAPI string
	HTTP        *http.Client

	mu     sync.Mutex
	cached *Key
	until  time.Time
}

const keyTTL = 5 * time.Minute

// Key fetches the support key from the control plane, cached 5 minutes.
func (s *Service) Key(ctx context.Context) (Key, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cached != nil && time.Now().Before(s.until) {
		return *s.cached, nil
	}
	hc := s.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 10 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(s.OperatorAPI, "/")+"/support/ssh-key", nil)
	if err != nil {
		return Key{}, err
	}
	res, err := hc.Do(req)
	if err != nil {
		return Key{}, fmt.Errorf("cannot reach Yundera for the support key: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return Key{}, fmt.Errorf("Yundera's /support/ssh-key returned %d", res.StatusCode)
	}
	var k Key
	if err := json.NewDecoder(http.MaxBytesReader(nil, res.Body, 64*1024)).Decode(&k); err != nil {
		return Key{}, errors.New("Yundera returned a malformed support key")
	}
	if k.PublicKey == "" || k.Fingerprint == "" || k.Algorithm == "" {
		return Key{}, errors.New("Yundera returned a malformed support key")
	}
	if k.Comment == "" {
		k.Comment = "pcs-support"
	}
	s.cached, s.until = &k, time.Now().Add(keyTTL)
	return k, nil
}

type Access struct {
	Enabled     bool   `json:"enabled"`
	Username    string `json:"username"`
	Fingerprint string `json:"fingerprint"`
	Comment     string `json:"comment"`
}

func (s *Service) exec(ctx context.Context, spec hostrun.Spec) (string, error) {
	res, err := s.Run.Run(ctx, spec)
	if err != nil {
		return "", err
	}
	// The scripts answer on stdout and may exit 2/3 with a marker word.
	if res.ExitCode != 0 && !strings.Contains(res.Stdout, "USER_NOT_FOUND") && !strings.Contains(res.Stdout, "HOME_MISSING") {
		return "", res.Err()
	}
	return res.Stdout, nil
}

// Status reports whether the support key is in the admin user's
// authorized_keys.
func (s *Service) Status(ctx context.Context) (Access, error) {
	k, err := s.Key(ctx)
	if err != nil {
		return Access{}, err
	}
	spec, err := hostverb.SupportStatus(User)
	if err != nil {
		return Access{}, err
	}
	out, err := s.exec(ctx, spec)
	if err != nil {
		return Access{}, err
	}
	a := Access{Username: User, Fingerprint: k.Fingerprint, Comment: k.Comment}
	for _, l := range strings.Split(out, "\n") {
		if strings.TrimSpace(l) == k.Fingerprint {
			a.Enabled = true
		}
	}
	return a, nil
}

// Enable adds the key; added is false when it was already there.
func (s *Service) Enable(ctx context.Context) (added bool, k Key, err error) {
	if k, err = s.Key(ctx); err != nil {
		return false, k, err
	}
	spec, err := hostverb.SupportEnable(User, k.PublicKey)
	if err != nil {
		return false, k, err
	}
	out, err := s.exec(ctx, spec)
	if err != nil {
		return false, k, err
	}
	if strings.Contains(out, "USER_NOT_FOUND") {
		return false, k, fmt.Errorf("user '%s' does not exist", User)
	}
	if strings.Contains(out, "HOME_MISSING") {
		return false, k, fmt.Errorf("home directory for '%s' does not exist", User)
	}
	return strings.Contains(out, "ADDED"), k, nil
}

// EnsureOptedOut reports whether ENSURE_SUPPORT_KEY opts out of the nightly
// re-add: false/0/no/off. Anything else (empty included) means ensure.
func EnsureOptedOut(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "false", "0", "no", "off":
		return true
	}
	return false
}
