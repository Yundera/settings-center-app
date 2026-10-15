package identity

import (
	"context"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/yundera/settings-center-app/internal/hostrun"
	"github.com/yundera/settings-center-app/internal/hostverb"
)

// Receiver serves GET /api/identity/key and POST /api/identity/push.
type Receiver struct {
	Keys  *KeyStore
	Trust *Trust
	Run   hostrun.Runner
	// Paths gives the host paths for the apply / self-check verbs.
	Paths func() hostverb.Paths
	// IssuerSetting reads TRUST_ISSUER (from .pcs.env); OperatorAPI is the
	// fallback base.
	IssuerSetting func() string
	OperatorAPI   string
	// StateFile records the last applied iat (identity-state.json).
	StateFile string
	Now       func() time.Time

	keyLimit, pushLimit *Limiter
	busyMu              sync.Mutex
	busy                bool
}

func (rc *Receiver) init() {
	if rc.keyLimit == nil {
		rc.keyLimit = NewLimiter(30, time.Minute)
		rc.pushLimit = NewLimiter(10, time.Minute)
	}
	if rc.Now == nil {
		rc.Now = time.Now
	}
}

// NewReceiver wires the default limits.
func NewReceiver(rc *Receiver) *Receiver {
	rc.init()
	return rc
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func errBody(msg string) map[string]string { return map[string]string{"error": msg} }

func (rc *Receiver) HandleKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeJSON(w, http.StatusMethodNotAllowed, errBody("Method not allowed"))
		return
	}
	if !rc.keyLimit.Allow() {
		writeJSON(w, http.StatusTooManyRequests, errBody("Too many requests"))
		return
	}
	k, err := rc.Keys.Issue()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errBody("cannot issue a key"))
		return
	}
	writeJSON(w, http.StatusOK, k)
}

// MaxBody bounds a push request.
const MaxBody = 32 * 1024

func (rc *Receiver) HandlePush(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeJSON(w, http.StatusMethodNotAllowed, errBody("Method not allowed"))
		return
	}
	if !rc.pushLimit.Allow() {
		writeJSON(w, http.StatusTooManyRequests, errBody("Too many requests"))
		return
	}
	// One push at a time: two concurrent applies would race on the env files.
	rc.busyMu.Lock()
	if rc.busy {
		rc.busyMu.Unlock()
		writeJSON(w, http.StatusConflict, errBody("Another push is being applied"))
		return
	}
	rc.busy = true
	rc.busyMu.Unlock()
	defer func() { rc.busyMu.Lock(); rc.busy = false; rc.busyMu.Unlock() }()

	var body struct {
		JWE any `json:"jwe"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxBody)).Decode(&body); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeJSON(w, http.StatusRequestEntityTooLarge, errBody("Body exceeded 32kb limit"))
			return
		}
		writeJSON(w, http.StatusBadRequest, errBody("bad jwe"))
		return
	}
	jwe, _ := body.JWE.(string)

	// The apply must finish even if the caller hangs up.
	ctx := context.WithoutCancel(r.Context())
	issuer := Issuer(rc.IssuerSetting(), rc.OperatorAPI)
	v, err := Open(ctx, jwe, rc.Keys.Take, issuer, func(ctx context.Context, kid string) (*rsa.PublicKey, error) {
		return rc.Trust.Key(ctx, issuer, kid)
	}, rc.Now())
	if err != nil {
		var rej Rejected
		if errors.As(err, &rej) {
			log.Printf("identity: push rejected: %s", rej.Reason)
			msg := rej.Reason
			if len(msg) > 80 {
				msg = msg[:80]
			}
			writeJSON(w, http.StatusBadRequest, errBody(msg))
			return
		}
		log.Printf("identity: push failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errBody("apply failed"))
		return
	}

	addrs, err := rc.hostAddresses(ctx)
	if err != nil {
		log.Printf("identity: cannot list host addresses: %v", err)
		writeJSON(w, http.StatusInternalServerError, errBody("apply failed"))
		return
	}
	if !addrs[v.Host] {
		writeJSON(w, http.StatusForbidden, errBody("host mismatch"))
		return
	}
	if v.Iat <= rc.lastIat() {
		writeJSON(w, http.StatusConflict, errBody("stale bundle"))
		return
	}

	changed, err := rc.apply(ctx, v)
	if err != nil {
		log.Printf("identity: push failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errBody("apply failed"))
		return
	}
	suffix := ""
	if changed {
		suffix = ", domain identity changed: self-check started"
	}
	log.Printf("identity: applied a pushed identity (iat %d)%s", v.Iat, suffix)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (rc *Receiver) hostAddresses(ctx context.Context) (map[string]bool, error) {
	res, err := rc.Run.Run(ctx, hostverb.HostAddrs())
	if err != nil {
		return nil, err
	}
	if err := res.Err(); err != nil {
		return nil, err
	}
	out := map[string]bool{}
	for _, l := range strings.Split(res.Stdout, "\n") {
		if a, _, _ := strings.Cut(strings.TrimSpace(l), "/"); a != "" {
			out[a] = true
		}
	}
	return out, nil
}

var identityChangedRe = regexp.MustCompile(`(?m)^identity-changed$`)

func (rc *Receiver) apply(ctx context.Context, v *Verified) (changed bool, err error) {
	p := rc.Paths()
	spec, err := hostverb.ApplyIdentity(p, v.Bundle.Lines())
	if err != nil {
		return false, err
	}
	res, err := rc.Run.Run(ctx, spec)
	if err != nil {
		return false, err
	}
	if err := res.Err(); err != nil {
		return false, err
	}
	rc.recordIat(v.Iat)
	if identityChangedRe.MatchString(res.Stdout) {
		// Same as the Run-now button: detached, and the self-check's own flock
		// makes it a no-op when a run (the one that rang the doorbell) is going.
		if sc, err := hostverb.SelfCheck(p); err == nil {
			if _, err := rc.Run.Run(ctx, sc); err != nil {
				log.Printf("identity: could not start the self-check: %v", err)
			}
		}
		return true, nil
	}
	return false, nil
}

// State is identity-state.json. Losing it is harmless — the bundle's 15-minute
// exp still bounds a replay — which is why it is a plain file in the data dir.
type State struct {
	LastIat   int64  `json:"lastIat"`
	AppliedAt string `json:"appliedAt"`
}

// ReadState returns the recorded state, zero when absent or unreadable.
func ReadState(path string) State {
	var s State
	raw, err := os.ReadFile(path)
	if err == nil {
		_ = json.Unmarshal(raw, &s)
	}
	return s
}

func (rc *Receiver) lastIat() int64 { return ReadState(rc.StateFile).LastIat }

func (rc *Receiver) recordIat(iat int64) {
	s := State{LastIat: iat, AppliedAt: rc.Now().UTC().Format("2006-01-02T15:04:05.000Z")}
	b, _ := json.Marshal(s)
	tmp := rc.StateFile + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err == nil {
		err = os.Rename(tmp, rc.StateFile)
		if err == nil {
			return
		}
	}
	if err := os.WriteFile(rc.StateFile, b, 0o644); err != nil {
		log.Printf("identity: could not record the applied iat in %s: %v", filepath.Base(rc.StateFile), err)
	}
}
