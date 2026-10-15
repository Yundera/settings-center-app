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
	calls []hostrun.Spec
	reply map[string]string // verb name -> stdout
}

func (f *fakeHost) Run(_ context.Context, s hostrun.Spec) (*hostrun.Result, error) {
	f.calls = append(f.calls, s)
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
		FeedbackToken: "fb-token",
	}
	host := &fakeHost{reply: map[string]string{
		"feature-yundera-login":    `{"id":"yundera-login","enabled":true}`,
		"feature-support-key":      `{"id":"support-key","enabled":true}`,
		"feature-platform-updates": `{"id":"platform-updates","enabled":true}`,
		"onboarding-status":        `{"claimed":true,"completed":true,"username":"alice"}`,
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
