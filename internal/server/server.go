// Package server wires the HTTP API and the embedded single-page app.
package server

import (
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/yundera/settings-center-app/internal/auth"
	"github.com/yundera/settings-center-app/internal/backup"
	"github.com/yundera/settings-center-app/internal/bench"
	"github.com/yundera/settings-center-app/internal/config"
	"github.com/yundera/settings-center-app/internal/envfile"
	"github.com/yundera/settings-center-app/internal/features"
	"github.com/yundera/settings-center-app/internal/gatectl"
	"github.com/yundera/settings-center-app/internal/health"
	"github.com/yundera/settings-center-app/internal/hostrun"
	"github.com/yundera/settings-center-app/internal/hostverb"
	"github.com/yundera/settings-center-app/internal/identity"
	"github.com/yundera/settings-center-app/internal/mail"
	"github.com/yundera/settings-center-app/internal/metrics"
	"github.com/yundera/settings-center-app/internal/onboarding"
	"github.com/yundera/settings-center-app/internal/support"
)

// Version is set at build time (-ldflags "-X .../server.Version=...").
var Version = "dev"

// CSRFHeader must accompany every state-changing request. A cross-site page
// cannot set it without a CORS preflight, which this server never answers, so
// the gate's session cookie alone can never trigger a host action.
const CSRFHeader = "X-Yundera-Admin"

type Server struct {
	cfg   config.Config
	authn auth.Authenticator
	run   hostrun.Runner
	gate  gatectl.Client
	mail  mail.Sender

	health   *health.Keeper
	metrics  *metrics.Sampler
	bench    *bench.Bench
	identity *identity.Receiver
	features features.Service
	onboard  onboarding.Service
	backup   backup.Service
	support  *support.Service

	// skips are the onboarding's "Skip for now" times; onb the slide state
	// Maison's check reads (onboarding.go). now is swapped by tests.
	skips *onboarding.Skips
	onb   onbCache
	jobs  backupJobs
	now   func() time.Time

	// featCache holds the last features read for the Overview, which polls;
	// any feature write drops it.
	featMu    sync.Mutex
	featCache []features.State
	featAt    time.Time
}

// Options lets tests swap the host and the mail relay.
type Options struct {
	Runner hostrun.Runner
	Mailer mail.Sender
}

// New builds the server and starts its background samplers until stop closes.
func New(cfg config.Config, uiFS fs.FS, stop <-chan struct{}) http.Handler {
	var run hostrun.Runner = hostrun.Unavailable{}
	if d, err := hostrun.New(cfg.SelfContainer, cfg.RunnerImage); err != nil {
		log.Printf("docker unavailable, host actions disabled: %v", err)
	} else {
		d.Sweep(context.Background())
		run = d
	}
	s := newServer(cfg, Options{Runner: run, Mailer: mail.SMTP{Addr: cfg.SMTPAddr, Domain: cfg.Domain}})
	s.health.Start(stop)
	s.metrics.Start(stop)
	s.startOnboardingRefresh(stop)
	return s.routes(uiFS)
}

func newServer(cfg config.Config, opt Options) *Server {
	s := &Server{cfg: cfg, run: opt.Runner, mail: opt.Mailer, now: time.Now}
	s.authn = auth.Authenticator{Secret: []byte(cfg.AssertionSecret), Audience: cfg.AssertionAudience}
	if cfg.AssertionSecret == "" && cfg.DevIdentity != "" && cfg.Env == "development" {
		log.Printf("WARNING: DEV_IDENTITY=%q — every request is treated as that admin", cfg.DevIdentity)
		s.authn.Dev = &auth.Identity{User: cfg.DevIdentity, Groups: []string{"admins"}, Method: "dev"}
	} else if cfg.AssertionSecret == "" {
		log.Print("WARNING: IDENTITY_ASSERTION_SECRET is not set — every authenticated request will be refused")
	}
	s.gate = gatectl.Client{BaseURL: cfg.GateURL, Secret: []byte(cfg.AssertionSecret)}
	s.health = health.New(Version, cfg.LocalPath("log/yundera.log"))
	s.metrics = metrics.New(s.run)
	s.bench = bench.New(s.run)
	s.features = features.Service{Run: s.run, Paths: s.paths}
	s.onboard = onboarding.Service{Run: s.run, Paths: s.paths}
	s.backup = backup.Service{Run: s.run, Paths: s.paths}
	s.skips = &onboarding.Skips{Path: filepath.Join(cfg.DataDir, "onboarding-skips.json"), Now: func() time.Time { return s.now() }}
	s.support = &support.Service{Run: s.run, OperatorAPI: cfg.OperatorAPI}
	s.identity = identity.NewReceiver(&identity.Receiver{
		Keys:          identity.NewKeyStore(),
		Trust:         identity.NewTrust(),
		Run:           s.run,
		Paths:         s.paths,
		IssuerSetting: func() string { return s.pcsEnv().Get("TRUST_ISSUER") },
		OperatorAPI:   cfg.OperatorAPI,
		StateFile:     filepath.Join(cfg.DataDir, "identity-state.json"),
	})
	return s
}

func (s *Server) paths() hostverb.Paths {
	return hostverb.Paths{Scripts: s.cfg.HostScripts(), Root: s.cfg.YunderaHostRoot}
}

// pcsEnv reads .pcs.env fresh from the read-only mount; a read failure is an
// empty env (every key in it is optional).
func (s *Server) pcsEnv() envfile.Env {
	env, err := envfile.Load(s.cfg.LocalPath(".pcs.env"))
	if err != nil {
		log.Printf("cannot read .pcs.env: %v", err)
		return envfile.Env{}
	}
	return env
}

func (s *Server) routes(uiFS fs.FS) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RealIP, middleware.Recoverer, securityHeaders)

	// Public: the gate's ALLOWED_PATHS (api/health, api/perf, api/bench,
	// api/identity) plus api/feedback and api/onboarding/check, which Maison
	// reaches directly over pcs and which authenticate with their own bearer.
	// Keep this list a SUPERSET of ALLOWED_PATHS (server_test.go checks it
	// against template-root); the check is deliberately NOT in ALLOWED_PATHS.
	r.Get("/api/health", s.handleHealth)
	r.Get("/api/perf", s.handlePerf)
	r.Get("/api/bench/disk", s.handleBenchDisk)
	r.Get("/api/bench/network", s.handleBenchNetwork)
	r.HandleFunc("/api/identity/key", s.identity.HandleKey)
	r.HandleFunc("/api/identity/push", s.identity.HandlePush)
	r.HandleFunc("/api/feedback/ingest", s.handleFeedback)
	r.Get("/api/onboarding/check", s.handleOnboardingCheck)

	r.Route("/api", func(api chi.Router) {
		api.Use(s.authn.RequireUser)
		api.Use(csrfGuard)
		api.Get("/me", s.handleMe)
		// Before the owner exists nobody is in `admins` yet: the wizard must load.
		api.Get("/onboarding/status", s.handleOnboardingStatus)

		api.Group(func(a chi.Router) {
			a.Use(auth.RequireAdmin)
			a.Get("/overview", s.handleOverview)
			a.Get("/selfcheck", s.handleSelfCheck)
			a.Get("/selfcheck/log", s.handleSelfCheckLog)
			a.Post("/selfcheck/run", s.handleSelfCheckRun)
			a.Get("/selfcheck/schedule", s.handleScheduleGet)
			a.Post("/selfcheck/schedule", s.handleScheduleSet)
			a.Get("/update-channel", s.handleChannelGet)
			a.Post("/update-channel", s.handleChannelSet)
			a.Get("/features", s.handleFeaturesGet)
			a.Post("/features", s.handleFeaturesSet)
			a.Post("/onboarding/claim", s.handleOnboardingClaim)
			a.Post("/onboarding/complete", s.handleOnboardingComplete)
			a.Post("/onboarding/reset", s.handleOnboardingReset)
			a.Post("/onboarding/skip", s.handleOnboardingSkip)
			a.Post("/backup", s.handleBackup)
			a.Get("/backup/job", s.handleBackupJob)
			a.Get("/support", s.handleSupportGet)
			a.Post("/support", s.handleSupportSet)
			a.Post("/support/report", s.handleSupportReport)
			a.Post("/reboot", s.handleReboot)
		})
		api.NotFound(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusNotFound, "not_found", "not found")
		})
	})

	r.Handle("/*", spaHandler(uiFS))
	return r
}

// ---- plumbing ------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError answers {"error": msg, "code": code}. The UI translates by code
// and shows msg only as technical detail.
func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{"error": msg, "code": code})
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "request body must be JSON")
		return false
	}
	return true
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Content-Security-Policy",
			"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		next.ServeHTTP(w, r)
	})
}

func csrfGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get(CSRFHeader) != "1" {
			writeError(w, http.StatusForbidden, "csrf", "missing "+CSRFHeader+" header")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// bg is the context for a host action started by a request: detached from the
// request so a client navigating away cannot kill it half way.
func bg(r *http.Request) context.Context { return context.WithoutCancel(r.Context()) }
