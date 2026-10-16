package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/yundera/settings-center-app/internal/auth"
	"github.com/yundera/settings-center-app/internal/config"
	"github.com/yundera/settings-center-app/internal/hostrun"
	"github.com/yundera/settings-center-app/internal/mail"
)

const secret = "test-secret"

type fakeHost struct {
	// mu: the onboarding refresh runs verbs from its own goroutine.
	mu    sync.Mutex
	calls []hostrun.Spec
	reply map[string]string // verb name -> stdout
	fail  map[string]string // verb name -> stderr of a failed run
}

func (f *fakeHost) Run(_ context.Context, s hostrun.Spec) (*hostrun.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, s)
	if msg, ok := f.fail[s.Name]; ok {
		return &hostrun.Result{ExitCode: 1, Stderr: msg}, nil
	}
	if out, ok := f.reply[s.Name]; ok {
		return &hostrun.Result{Stdout: out}, nil
	}
	if s.Detached {
		return nil, nil
	}
	return nil, errors.New("no fake for " + s.Name)
}

type fakeMail struct{ sent []mail.Message }

func (f *fakeMail) Send(m mail.Message) error { f.sent = append(f.sent, m); return nil }

func fixture(t *testing.T) (*Server, http.Handler, *fakeHost, *fakeMail) {
	t.Helper()
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, "log"), 0o755)
	_ = os.MkdirAll(filepath.Join(dir, "template", "scripts"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, ".pcs.env"), []byte("UPDATE_URL=\nPUBLIC_IP=203.0.113.7\n"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, ".ynd.user.env"), []byte("DOMAIN=alice.nsl.sh\n"), 0o644)
	raw, _ := os.ReadFile("../selfcheck/testdata/yundera.log")
	_ = os.WriteFile(filepath.Join(dir, "log", "yundera.log"), raw, 0o644)
	cfg := config.Config{
		YunderaDir: dir, YunderaHostRoot: "/DATA/AppData/yundera", DataDir: t.TempDir(),
		AssertionSecret: secret, AssertionAudience: "admin", GateURL: "http://127.0.0.1:1",
		Domain: "alice.nsl.sh", UID: "uid1", OperatorAPI: "http://127.0.0.1:1",
		FeedbackToken: "fb-token", OnboardingCheckToken: "ob-token",
	}
	host := &fakeHost{fail: map[string]string{}, reply: map[string]string{
		"feature-yundera-login":    `{"id":"yundera-login","enabled":true}`,
		"feature-support-key":      `{"id":"support-key","enabled":true}`,
		"feature-platform-updates": `{"id":"platform-updates","enabled":true}`,
		"onboarding-status":        `{"claimed":true,"completed":true,"username":"alice"}`,
		"backup-status":            `{"enabled":true,"state":"ready","engine":"kopia","spaceId":"s1"}`,
		"env-set":                  "",
		"ensure-nightly":           "",
	}}
	m := &fakeMail{}
	s := newServer(cfg, Options{Runner: host, Mailer: m})
	s.health.Refresh()
	ui := fstest.MapFS{"index.html": {Data: []byte("<html>app</html>")}, "assets/a.js": {Data: []byte("js")}}
	return s, s.routes(ui), host, m
}

func mint(t *testing.T, groups []string, method string) string {
	t.Helper()
	enc := base64.RawURLEncoding
	h := enc.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	c, _ := json.Marshal(map[string]any{"iss": "appshield", "aud": "admin", "user": "alice", "email": "a@x", "method": method, "groups": groups,
		"iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix()})
	in := h + "." + enc.EncodeToString(c)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(in))
	return in + "." + enc.EncodeToString(mac.Sum(nil))
}

func do(h http.Handler, method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Host = "admin-alice.nsl.sh"
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

var adminRoutes = []struct{ method, path string }{
	{"GET", "/api/overview"}, {"GET", "/api/selfcheck"}, {"GET", "/api/selfcheck/log"}, {"POST", "/api/selfcheck/run"},
	{"GET", "/api/selfcheck/schedule"}, {"POST", "/api/selfcheck/schedule"}, {"GET", "/api/update-channel"},
	{"POST", "/api/update-channel"}, {"GET", "/api/features"}, {"POST", "/api/features"},
	{"POST", "/api/onboarding/claim"}, {"POST", "/api/onboarding/complete"}, {"POST", "/api/onboarding/reset"},
	{"POST", "/api/onboarding/skip"}, {"POST", "/api/backup"}, {"GET", "/api/backup/job"},
	{"GET", "/api/support"}, {"POST", "/api/support"}, {"POST", "/api/support/report"}, {"POST", "/api/reboot"},
}

func TestAdminRoutesNeedAnAdmin(t *testing.T) {
	_, h, host, _ := fixture(t)
	user := mint(t, []string{"users"}, "oidc")
	machine := mint(t, []string{"admins"}, "hash")
	for _, rt := range adminRoutes {
		csrf := map[string]string{CSRFHeader: "1"}
		if w := do(h, rt.method, rt.path, "{}", csrf); w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without assertion: %d", rt.method, rt.path, w.Code)
		}
		// The plain forward-auth headers prove nothing.
		if w := do(h, rt.method, rt.path, "{}", map[string]string{CSRFHeader: "1", "Remote-User": "alice", "Remote-Groups": "admins"}); w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s with Remote-* headers: %d", rt.method, rt.path, w.Code)
		}
		if w := do(h, rt.method, rt.path, "{}", map[string]string{CSRFHeader: "1", auth.HeaderAssertion: user}); w.Code != http.StatusForbidden {
			t.Errorf("%s %s as non-admin: %d", rt.method, rt.path, w.Code)
		}
		if w := do(h, rt.method, rt.path, "{}", map[string]string{CSRFHeader: "1", auth.HeaderAssertion: machine}); w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s as a machine identity: %d", rt.method, rt.path, w.Code)
		}
	}
	if len(host.calls) != 0 {
		t.Fatalf("host actions ran for refused requests: %+v", host.calls)
	}
}

func TestCSRF(t *testing.T) {
	_, h, host, _ := fixture(t)
	admin := mint(t, []string{"admins"}, "oidc")
	w := do(h, "POST", "/api/reboot", "", map[string]string{auth.HeaderAssertion: admin})
	if w.Code != http.StatusForbidden || len(host.calls) != 0 {
		t.Fatalf("POST without %s: %d, calls %d", CSRFHeader, w.Code, len(host.calls))
	}
	w = do(h, "POST", "/api/reboot", "", map[string]string{auth.HeaderAssertion: admin, CSRFHeader: "1"})
	if w.Code != http.StatusOK || len(host.calls) != 1 || host.calls[0].Name != "reboot" || !host.calls[0].Detached {
		t.Fatalf("reboot: %d %+v", w.Code, host.calls)
	}
}

func TestOnboardingStatusForAnySignedInUser(t *testing.T) {
	_, h, _, _ := fixture(t)
	w := do(h, "GET", "/api/onboarding/status", "", map[string]string{auth.HeaderAssertion: mint(t, nil, "oidc")})
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"claimed":true`) {
		t.Fatalf("status: %d %s", w.Code, w.Body)
	}
	if w := do(h, "GET", "/api/me", "", map[string]string{auth.HeaderAssertion: mint(t, nil, "oidc")}); w.Code != 200 || !strings.Contains(w.Body.String(), `"role":"user"`) {
		t.Fatalf("me: %d %s", w.Code, w.Body)
	}
}

func TestPublicRoutes(t *testing.T) {
	_, h, _, _ := fixture(t)
	for _, p := range []string{"/api/health", "/api/perf", "/api/bench/disk", "/api/bench/network", "/api/identity/key"} {
		w := do(h, "GET", p, "", nil)
		if w.Code != http.StatusOK || !json.Valid(w.Body.Bytes()) || w.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("%s: %d %s", p, w.Code, w.Body)
		}
	}
	w := do(h, "GET", "/api/health", "", nil)
	if !strings.Contains(w.Body.String(), `"passed":25,"total":25`) {
		t.Fatalf("health = %s", w.Body)
	}
	if w := do(h, "POST", "/api/identity/push", `{"jwe":"x"}`, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("push garbage: %d", w.Code)
	}
}

func TestFeedback(t *testing.T) {
	_, h, _, m := fixture(t)
	if w := do(h, "GET", "/api/feedback/ingest", "", nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("no bearer: %d", w.Code)
	}
	bearer := map[string]string{"Authorization": "Bearer fb-token"}
	w := do(h, "GET", "/api/feedback/ingest", "", bearer)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"supportUrl":"https://admin-alice.nsl.sh/support"`) {
		t.Fatalf("GET: %d %s", w.Code, w.Body)
	}
	w = do(h, "POST", "/api/feedback/ingest", `{"message":"The backup page is confusing\nmore","category":"idea","context":{"source":"maison","version":"1.1.59","page":"/settings"}}`, bearer)
	if w.Code != http.StatusAccepted || len(m.sent) != 1 {
		t.Fatalf("POST: %d %s", w.Code, w.Body)
	}
	if m.sent[0].To != "support@yundera.com" || m.sent[0].Subject != "[PCS Feedback] idea: The backup page is confusing" || !strings.Contains(m.sent[0].Text, "Source: maison 1.1.59") {
		t.Fatalf("mail = %+v", m.sent[0])
	}
	if w := do(h, "POST", "/api/feedback/ingest", `{"message":"  "}`, bearer); w.Code != http.StatusBadRequest {
		t.Fatalf("empty message: %d", w.Code)
	}

	s, h2, _, _ := fixture(t)
	s.cfg.FeedbackToken = ""
	if w := do(h2, "GET", "/api/feedback/ingest", "", bearer); w.Code != http.StatusNotFound {
		t.Fatalf("unconfigured: %d", w.Code)
	}
}

func TestOverview(t *testing.T) {
	_, h, _, _ := fixture(t)
	w := do(h, "GET", "/api/overview", "", map[string]string{auth.HeaderAssertion: mint(t, []string{"admins"}, "oidc")})
	if w.Code != 200 {
		t.Fatalf("overview: %d %s", w.Code, w.Body)
	}
	var out struct {
		Domain, PublicIP string
		Links            struct{ Maison, Kopia string }
		Summary          struct {
			Tiles map[string]struct{ Code string }
		}
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.Domain != "alice.nsl.sh" || out.Links.Kopia != "https://kopia-alice.nsl.sh" || out.Summary.Tiles["support"].Code != "support.on" || out.Summary.Tiles["updates"].Code != "updates.on" {
		t.Fatalf("overview = %s", w.Body)
	}
}

func TestFeatureGuard(t *testing.T) {
	_, h, host, _ := fixture(t)
	host.reply["onboarding-status"] = `{"claimed":false,"completed":false,"username":""}`
	admin := map[string]string{auth.HeaderAssertion: mint(t, []string{"admins"}, "oidc"), CSRFHeader: "1"}
	w := do(h, "POST", "/api/features", `{"id":"yundera-login","enabled":false}`, admin)
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "guard_login-only-way-in") {
		t.Fatalf("guard: %d %s", w.Code, w.Body)
	}
	for _, c := range host.calls {
		if c.Name == "feature-yundera-login" && c.Argv[len(c.Argv)-1] == "disable" {
			t.Fatal("disabled despite the guard")
		}
	}
}

func TestScheduleValidation(t *testing.T) {
	_, h, host, _ := fixture(t)
	admin := map[string]string{auth.HeaderAssertion: mint(t, []string{"admins"}, "oidc"), CSRFHeader: "1"}
	if w := do(h, "POST", "/api/selfcheck/schedule", `{"value":"0 3 * * *; reboot"}`, admin); w.Code != http.StatusBadRequest || len(host.calls) != 0 {
		t.Fatalf("bad cron: %d", w.Code)
	}
	if w := do(h, "POST", "/api/selfcheck/schedule", `{"value":"30 4 * * *"}`, admin); w.Code != 200 || len(host.calls) != 2 {
		t.Fatalf("good cron: %d %+v", w.Code, host.calls)
	}
}

func TestSPA(t *testing.T) {
	_, h, _, _ := fixture(t)
	for _, p := range []string{"/", "/health", "/support?autoEnable=1"} {
		if w := do(h, "GET", p, "", nil); w.Code != 200 || w.Body.String() != "<html>app</html>" {
			t.Errorf("%s: %d %q", p, w.Code, w.Body)
		}
	}
	if w := do(h, "GET", "/assets/a.js", "", nil); !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
		t.Error("assets not cached")
	}
	if w := do(h, "GET", "/api/nope", "", map[string]string{auth.HeaderAssertion: mint(t, []string{"admins"}, "oidc")}); w.Code != 404 || !json.Valid(w.Body.Bytes()) {
		t.Errorf("unknown api: %d", w.Code)
	}
}

// The gate lets ALLOWED_PATHS through without a session. Every one of them must
// be a route this app serves without an assertion, or the control plane's
// polls and pushes would hit a 401 here.
func TestPublicRoutesCoverGateAllowedPaths(t *testing.T) {
	compose := "../../../template-root/root/docker-compose.yml"
	raw, err := os.ReadFile(compose)
	if err != nil {
		t.Skipf("template-root not checked out next to this repo: %v", err)
	}
	m := regexp.MustCompile(`ALLOWED_PATHS:\s*"([^"]*)"`).FindAllStringSubmatch(string(raw), -1)
	if len(m) == 0 {
		t.Fatal("no ALLOWED_PATHS in template-root's compose")
	}
	_, h, _, _ := fixture(t)
	public := map[string]string{
		"api/health": "/api/health", "api/perf": "/api/perf", "api/bench": "/api/bench/disk",
		"api/identity": "/api/identity/key", "api/feedback": "/api/feedback/ingest",
	}
	for _, p := range strings.Split(m[0][1], ",") {
		p = strings.TrimSpace(p)
		if p == "api/brand" {
			continue // v1 only; dropped from the gate in the same release
		}
		probe, ok := public[p]
		if !ok {
			t.Errorf("gate allows %q but this app has no public route for it", p)
			continue
		}
		if w := do(h, "GET", probe, "", nil); w.Code == http.StatusUnauthorized {
			t.Errorf("%s (from ALLOWED_PATHS %q) answers 401", probe, p)
		}
	}
}

// set changes the fake's answers once no refresh is reading them.
func (f *fakeHost) set(name, stdout string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reply[name] = stdout
}

func (f *fakeHost) named(name string) []hostrun.Spec {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []hostrun.Spec
	for _, c := range f.calls {
		if c.Name == name {
			out = append(out, c)
		}
	}
	return out
}

type checkAnswer struct {
	Show bool   `json:"show"`
	URL  string `json:"url"`
}

func check(t *testing.T, h http.Handler) checkAnswer {
	t.Helper()
	w := do(h, "GET", "/api/onboarding/check", "", map[string]string{"Authorization": "Bearer ob-token"})
	var out checkAnswer
	if w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-store" || json.Unmarshal(w.Body.Bytes(), &out) != nil {
		t.Fatalf("check: %d %s", w.Code, w.Body)
	}
	return out
}

func TestOnboardingCheck(t *testing.T) {
	s, h, host, _ := fixture(t)
	if w := do(h, "GET", "/api/onboarding/check", "", nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("no bearer: %d", w.Code)
	}
	if w := do(h, "GET", "/api/onboarding/check", "", map[string]string{"Authorization": "Bearer fb-token"}); w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong bearer: %d", w.Code)
	}
	// A settled box (claimed, backups ready): nothing to show. The first call
	// fills the cache itself.
	if a := check(t, h); a.Show || a.URL != "https://admin-alice.nsl.sh/" {
		t.Fatalf("settled = %+v", a)
	}
	// Answered from RAM: further checks run nothing on the host.
	before := len(host.named("onboarding-status"))
	for range 5 {
		check(t, h)
	}
	if n := len(host.named("onboarding-status")); n != before {
		t.Fatalf("check ran onboarding.sh %d more times", n-before)
	}

	host.set("backup-status", `{"enabled":true,"state":"needs-secret","engine":"kopia","spaceId":"s1"}`)
	<-s.refreshOnboarding()
	if a := check(t, h); !a.Show {
		t.Fatalf("needs-secret = %+v", a)
	}
	host.set("backup-status", `{"enabled":false,"state":"disabled","engine":"kopia","spaceId":"s1"}`)
	<-s.refreshOnboarding()
	if a := check(t, h); a.Show {
		t.Fatalf("disabled = %+v", a)
	}
	host.set("onboarding-status", `{"claimed":false,"completed":false,"username":""}`)
	<-s.refreshOnboarding()
	if a := check(t, h); !a.Show {
		t.Fatalf("unclaimed = %+v", a)
	}

	// backup.sh failing is no reason to send Maison's visitors here; the UI
	// still shows the slide as unavailable.
	host.set("onboarding-status", `{"claimed":true,"completed":true,"username":"alice"}`)
	host.mu.Lock()
	host.fail["backup-status"] = "ERROR: boom"
	host.mu.Unlock()
	<-s.refreshOnboarding()
	if a := check(t, h); a.Show {
		t.Fatalf("backup.sh failing = %+v", a)
	}
	w := do(h, "GET", "/api/onboarding/status", "", map[string]string{auth.HeaderAssertion: mint(t, []string{"admins"}, "oidc")})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"backup":{"enabled":false,"state":"unavailable"}`) || !strings.Contains(w.Body.String(), `{"id":"backup","state":"pending"}`) {
		t.Fatalf("status with backup.sh failing: %d %s", w.Code, w.Body)
	}

	s2, h2, _, _ := fixture(t)
	s2.cfg.OnboardingCheckToken = ""
	if w := do(h2, "GET", "/api/onboarding/check", "", map[string]string{"Authorization": "Bearer ob-token"}); w.Code != http.StatusNotFound {
		t.Fatalf("unconfigured: %d", w.Code)
	}
}

func TestOnboardingSkipAndReminder(t *testing.T) {
	s, h, host, _ := fixture(t)
	clock := time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	host.set("backup-status", `{"enabled":true,"state":"needs-recovery","engine":"kopia","spaceId":"s1"}`)
	admin := map[string]string{auth.HeaderAssertion: mint(t, []string{"admins"}, "oidc"), CSRFHeader: "1"}

	type status struct {
		Slides []struct {
			ID, State string
			SkippedAt *time.Time
		}
		Backup struct{ State string }
	}
	read := func() status {
		t.Helper()
		w := do(h, "GET", "/api/onboarding/status", "", admin)
		var out status
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &out) != nil || len(out.Slides) != 2 {
			t.Fatalf("status: %d %s", w.Code, w.Body)
		}
		return out
	}
	st := read()
	if st.Slides[0].ID != "account" || st.Slides[0].State != "done" || st.Slides[1].ID != "backup" || st.Slides[1].State != "pending" || st.Backup.State != "needs-recovery" {
		t.Fatalf("before skip = %+v", st)
	}
	if !check(t, h).Show {
		t.Fatal("pending backup slide not shown")
	}

	if w := do(h, "POST", "/api/onboarding/skip", `{"slide":"nope"}`, admin); w.Code != http.StatusBadRequest {
		t.Fatalf("unknown slide: %d", w.Code)
	}
	if w := do(h, "POST", "/api/onboarding/skip", `{"slide":"backup"}`, admin); w.Code != 200 {
		t.Fatalf("skip: %d %s", w.Code, w.Body)
	}
	raw, err := os.ReadFile(filepath.Join(s.cfg.DataDir, "onboarding-skips.json"))
	if err != nil || !strings.Contains(string(raw), `"backup": "2026-10-16T09:00:00Z"`) {
		t.Fatalf("skip store = %s %v", raw, err)
	}
	st = read()
	if st.Slides[1].State != "skipped" || st.Slides[1].SkippedAt == nil || !st.Slides[1].SkippedAt.Equal(clock) {
		t.Fatalf("after skip = %+v", st.Slides[1])
	}
	if check(t, h).Show {
		t.Fatal("skipped slide still shown")
	}

	clock = clock.Add(71 * time.Hour)
	if check(t, h).Show {
		t.Fatal("reminder came back before 72h")
	}
	clock = clock.Add(time.Hour)
	if !check(t, h).Show {
		t.Fatal("reminder not back after 72h")
	}
	if st := read(); st.Slides[1].State != "pending" || st.Slides[1].SkippedAt == nil {
		t.Fatalf("after 72h = %+v", st.Slides[1])
	}

	// The skip store survives a restart.
	s2 := newServer(s.cfg, Options{Runner: host, Mailer: &fakeMail{}})
	if at, ok := s2.skips.All()["backup"]; !ok || !at.Equal(time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)) {
		t.Fatalf("reloaded skips = %v", s2.skips.All())
	}
}

func TestBackupAction(t *testing.T) {
	srv, h, host, _ := fixture(t)
	admin := map[string]string{auth.HeaderAssertion: mint(t, []string{"admins"}, "oidc"), CSRFHeader: "1"}
	const pw = "correct horse battery staple"

	for body, code := range map[string]string{
		`{"action":"probe"}`:                                 "unknown_action",
		`{"action":"init","password":"short"}`:               "too_short",
		`{"action":"init","password":"sixteen chars ok\nx"}`: "invalid_backup_password",
		`{"action":"reset"}`:                                 "confirm_required",
	} {
		w := do(h, "POST", "/api/backup", body, admin)
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"code":"`+code+`"`) {
			t.Errorf("%s: %d %s", body, w.Code, w.Body)
		}
	}
	if len(host.calls) != 0 {
		t.Fatalf("host actions ran for refused requests: %+v", host.calls)
	}

	// Long actions run as a background job: 202 now, the result on /api/backup/job.
	job := func(t *testing.T, s *Server) backupJob {
		t.Helper()
		s.jobs.mu.Lock()
		done := s.jobs.done
		s.jobs.mu.Unlock()
		<-done
		w := do(h, "GET", "/api/backup/job", "", admin)
		var out backupJob
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &out) != nil {
			t.Fatalf("job: %d %s", w.Code, w.Body)
		}
		return out
	}
	if w := do(h, "GET", "/api/backup/job", "", admin); !strings.Contains(w.Body.String(), `"job":"idle"`) {
		t.Fatalf("job before any: %s", w.Body)
	}

	host.set("backup-init", `{"enabled":true,"state":"ready","engine":"kopia","spaceId":"s1"}`)
	w := do(h, "POST", "/api/backup", `{"action":"init","password":"`+pw+`"}`, admin)
	if w.Code != http.StatusAccepted || !strings.Contains(w.Body.String(), `"job":"running"`) {
		t.Fatalf("init: %d %s", w.Code, w.Body)
	}
	if j := job(t, srv); j.Job != "done" || j.Action != "init" || j.Backup == nil || j.Backup.State != "ready" {
		t.Fatalf("init job = %+v", j)
	}
	calls := host.named("backup-init")
	if len(calls) != 1 || string(calls[0].Stdin) != pw+"\n" || strings.Contains(strings.Join(calls[0].Argv, " "), "horse") {
		t.Fatalf("init call = %+v", calls)
	}

	host.mu.Lock()
	host.fail["backup-recover"] = "ERROR: Error: the key does not open this repository [wrong_key]"
	host.fail["backup-reset"] = "ERROR: RESET_RATE_LIMIT: too many resets today for this account; try again tomorrow"
	host.mu.Unlock()
	if w := do(h, "POST", "/api/backup", `{"action":"recover","password":"`+pw+`"}`, admin); w.Code != http.StatusAccepted {
		t.Fatalf("recover: %d %s", w.Code, w.Body)
	}
	if j := job(t, srv); j.Job != "failed" || j.Code != "wrong_key" || j.Backup != nil {
		t.Fatalf("wrong key job = %+v", j)
	}
	if w := do(h, "POST", "/api/backup", `{"action":"reset","confirm":true}`, admin); w.Code != http.StatusAccepted {
		t.Fatalf("reset: %d %s", w.Code, w.Body)
	}
	if j := job(t, srv); j.Code != "rate_limited" {
		t.Fatalf("rate limited job = %+v", j)
	}
	if calls := host.named("backup-reset"); len(calls) != 1 || strings.Join(calls[0].Argv[2:], " ") != "reset --confirm" {
		t.Fatalf("reset call = %+v", calls)
	}

	// One job at a time.
	srv.jobs.mu.Lock()
	srv.jobs.cur = backupJob{Job: "running", Action: "recover"}
	srv.jobs.mu.Unlock()
	if w := do(h, "POST", "/api/backup", `{"action":"disable"}`, admin); w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), `"code":"backup_busy"`) {
		t.Fatalf("second job: %d %s", w.Code, w.Body)
	}
	srv.jobs.mu.Lock()
	srv.jobs.cur = backupJob{Job: "done"}
	srv.jobs.mu.Unlock()

	// A password sent with a verb that takes none is dropped, not passed on.
	host.set("backup-disable", `{"enabled":false,"state":"disabled","engine":"kopia","spaceId":"s1"}`)
	if w := do(h, "POST", "/api/backup", `{"action":"disable","password":"`+pw+`"}`, admin); w.Code != http.StatusAccepted {
		t.Fatalf("disable: %d %s", w.Code, w.Body)
	}
	if j := job(t, srv); j.Backup == nil || j.Backup.State != "disabled" {
		t.Fatalf("disable job = %+v", j)
	}
	if calls := host.named("backup-disable"); len(calls) != 1 || calls[0].Stdin != nil {
		t.Fatalf("disable call = %+v", calls)
	}

	// status stays synchronous.
	if w := do(h, "POST", "/api/backup", `{"action":"status"}`, admin); w.Code != 200 || !strings.Contains(w.Body.String(), `"state":"ready"`) || strings.Contains(w.Body.String(), "s1") {
		t.Fatalf("status: %d %s", w.Code, w.Body)
	}
}
