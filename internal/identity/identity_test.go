package identity

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/yundera/settings-center-app/internal/hostrun"
	"github.com/yundera/settings-center-app/internal/hostverb"
)

// fixture is testdata/orchestrator-push.json, produced by the orchestrator's
// own signIdentityBundle + encryptForBox (see testdata/gen.mjs).
type fixture struct {
	Issuer        string `json:"issuer"`
	BoxKid        string `json:"boxKid"`
	BoxPrivateJWK struct {
		D string `json:"d"`
	} `json:"boxPrivateJwk"`
	JWKS struct {
		Keys []jwk `json:"keys"`
	} `json:"jwks"`
	Iat    int64             `json:"iat"`
	Host   string            `json:"host"`
	Bundle map[string]string `json:"bundle"`
	JWE    string            `json:"jwe"`
}

func load(t *testing.T) fixture {
	t.Helper()
	raw, err := os.ReadFile("testdata/orchestrator-push.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f fixture) boxKey(t *testing.T) *ecdh.PrivateKey {
	d, err := b64.DecodeString(f.BoxPrivateJWK.D)
	if err != nil {
		t.Fatal(err)
	}
	k, err := ecdh.X25519().NewPrivateKey(d)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func (f fixture) rsaKey(t *testing.T) *rsa.PublicKey {
	k, err := f.JWKS.Keys[0].rsaPublic()
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func (f fixture) at() time.Time { return time.Unix(f.Iat+10, 0) }

func TestOpenOrchestratorBundle(t *testing.T) {
	f := load(t)
	box := f.boxKey(t)
	take := func(kid string) *ecdh.PrivateKey {
		if kid == f.BoxKid {
			return box
		}
		return nil
	}
	keys := func(_ context.Context, kid string) (*rsa.PublicKey, error) {
		if kid != "sig-1" {
			return nil, errors.New("no matching key")
		}
		return f.rsaKey(t), nil
	}
	v, err := Open(context.Background(), f.JWE, take, f.Issuer, keys, f.at())
	if err != nil {
		t.Fatal(err)
	}
	if v.Host != f.Host || v.Iat != f.Iat {
		t.Fatalf("verified = %+v", v)
	}
	for k, want := range f.Bundle {
		if v.Bundle[k] != want {
			t.Errorf("%s = %q, want %q", k, v.Bundle[k], want)
		}
	}
	if !strings.HasPrefix(string(v.Bundle.Lines()), "UID=uid_ABC123\nDOMAIN=alice.nsl.sh\n") {
		t.Fatalf("lines = %q", v.Bundle.Lines())
	}

	reason := func(err error) string {
		var r Rejected
		if !errors.As(err, &r) {
			t.Fatalf("not a rejection: %v", err)
		}
		return r.Reason
	}
	cases := []struct {
		name   string
		jwe    string
		take   func(string) *ecdh.PrivateKey
		issuer string
		at     time.Time
		want   string
	}{
		{"unknown key", f.JWE, func(string) *ecdh.PrivateKey { return nil }, f.Issuer, f.at(), "unknown or used key"},
		{"empty", "", take, f.Issuer, f.at(), "bad jwe"},
		{"garbage", "a.b.c", take, f.Issuer, f.at(), "bad jwe"},
		{"too big", strings.Repeat("a", maxJWE+1), take, f.Issuer, f.at(), "bad jwe"},
		{"tampered ciphertext", tamper(f.JWE, 3), take, f.Issuer, f.at(), "cannot decrypt"},
		{"tampered header", retag(f.JWE), take, f.Issuer, f.at(), "cannot decrypt"},
		{"wrong issuer", f.JWE, take, "https://evil.test/auth", f.at(), `signature: unexpected "iss" claim value`},
		{"expired", f.JWE, take, f.Issuer, time.Unix(f.Iat+901, 0), `signature: "exp" claim timestamp check failed`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := Open(context.Background(), c.jwe, c.take, c.issuer, keys, c.at)
			if got := reason(err); got != c.want {
				t.Fatalf("reason = %q, want %q", got, c.want)
			}
		})
	}
	// A key the issuer does not hold: the signature must not verify.
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	_, err = Open(context.Background(), f.JWE, take, f.Issuer, func(context.Context, string) (*rsa.PublicKey, error) {
		return &other.PublicKey, nil
	}, f.at())
	if reason(err) != "signature: signature verification failed" {
		t.Fatalf("wrong key: %v", err)
	}
	// A JWKS outage is not the bundle's fault: not a rejection.
	_, err = Open(context.Background(), f.JWE, take, f.Issuer, func(context.Context, string) (*rsa.PublicKey, error) {
		return nil, errors.New("issuer discovery: connection refused")
	}, f.at())
	var r Rejected
	if err == nil || errors.As(err, &r) {
		t.Fatalf("outage: %v", err)
	}
}

// tamper flips a character of compact-JWE part i.
func tamper(jwe string, i int) string {
	p := strings.Split(jwe, ".")
	b := []byte(p[i])
	if b[0] == 'A' {
		b[0] = 'B'
	} else {
		b[0] = 'A'
	}
	p[i] = string(b)
	return strings.Join(p, ".")
}

// retag rewrites the protected header (it is the GCM additional data).
func retag(jwe string) string {
	p := strings.Split(jwe, ".")
	raw, _ := b64.DecodeString(p[0])
	var h map[string]any
	_ = json.Unmarshal(raw, &h)
	h["cty"] = "X"
	nb, _ := json.Marshal(h)
	p[0] = b64.EncodeToString(nb)
	return strings.Join(p, ".")
}

func TestKeyStore(t *testing.T) {
	s := NewKeyStore()
	clock := time.Now()
	s.now = func() time.Time { return clock }
	k, err := s.Issue()
	if err != nil || k.JWK.Kty != "OKP" || k.JWK.Crv != "X25519" || len(k.JWK.X) != 43 || len(k.Kid) != 36 {
		t.Fatalf("key = %+v %v", k, err)
	}
	if s.Take(k.Kid) == nil || s.Take(k.Kid) != nil {
		t.Fatal("a key must be usable exactly once")
	}
	k2, _ := s.Issue()
	clock = clock.Add(KeyTTL + time.Second)
	if s.Take(k2.Kid) != nil {
		t.Fatal("expired key accepted")
	}
	first, _ := s.Issue()
	for i := 0; i < MaxKeys; i++ {
		_, _ = s.Issue()
	}
	if s.Take(first.Kid) != nil {
		t.Fatal("store is not bounded")
	}
}

func TestLimiter(t *testing.T) {
	l := NewLimiter(2, time.Minute)
	clock := time.Now()
	l.now = func() time.Time { return clock }
	if !l.Allow() || !l.Allow() || l.Allow() {
		t.Fatal("window count wrong")
	}
	clock = clock.Add(time.Minute)
	if !l.Allow() {
		t.Fatal("window did not reset")
	}
}

func TestIssuer(t *testing.T) {
	if Issuer("", "https://app.yundera.com/service/pcs/") != "https://app.yundera.com/service/pcs/auth" {
		t.Fatal("default issuer")
	}
	if Issuer(" https://x/auth/ ", "https://y") != "https://x/auth" {
		t.Fatal("TRUST_ISSUER override")
	}
}

func TestTrustDiscovery(t *testing.T) {
	f := load(t)
	var issuer string
	jwksHits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/auth/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{"issuer": issuer, "jwks_uri": issuer + "/jwks"})
		case "/auth/jwks":
			jwksHits++
			_ = json.NewEncoder(w).Encode(f.JWKS)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	issuer = srv.URL + "/auth"
	tr := NewTrust()
	if _, err := tr.Key(context.Background(), issuer, "sig-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := tr.Key(context.Background(), issuer, "rotated"); err == nil || jwksHits != 1 {
		t.Fatalf("unknown kid inside the cooldown: err=%v hits=%d", err, jwksHits)
	}
	// A discovery document naming another issuer is refused.
	if _, err := NewTrust().Key(context.Background(), srv.URL+"/auth/", "sig-1"); err == nil {
		t.Fatal("issuer mismatch accepted")
	}
}

// ---- the HTTP receiver -------------------------------------------------------

type hostFake struct {
	addrs    string
	applied  []byte
	stdout   string
	selfChck int
}

func (h *hostFake) Run(_ context.Context, s hostrun.Spec) (*hostrun.Result, error) {
	switch s.Name {
	case "host-addrs":
		return &hostrun.Result{Stdout: h.addrs}, nil
	case "apply-identity":
		h.applied = s.Stdin
		return &hostrun.Result{Stdout: h.stdout}, nil
	case "self-check":
		h.selfChck++
		return nil, nil
	}
	return nil, errors.New("unexpected verb " + s.Name)
}

func newTestReceiver(t *testing.T, f fixture, host *hostFake) *Receiver {
	rc := NewReceiver(&Receiver{
		Keys:  NewKeyStore(),
		Trust: NewTrust(),
		Run:   host,
		Paths: func() hostverb.Paths {
			return hostverb.Paths{Scripts: "/DATA/AppData/yundera/template/scripts", Root: "/DATA/AppData/yundera"}
		},
		IssuerSetting: func() string { return f.Issuer },
		StateFile:     filepath.Join(t.TempDir(), "identity-state.json"),
		Now:           f.at,
	})
	rc.Keys.put(f.BoxKid, f.boxKey(t))
	rc.Trust.sets[f.Issuer] = &keySet{keys: map[string]*rsa.PublicKey{"sig-1": f.rsaKey(t)}, fetchedAt: time.Now()}
	return rc
}

func push(rc *Receiver, jwe string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(map[string]string{"jwe": jwe})
	w := httptest.NewRecorder()
	rc.HandlePush(w, httptest.NewRequest(http.MethodPost, "/api/identity/push", bytes.NewReader(b)))
	return w
}

func TestPushApplies(t *testing.T) {
	f := load(t)
	host := &hostFake{addrs: "127.0.0.1/8\n203.0.113.7/24\n::1/128\n", stdout: "identity-changed\n"}
	rc := newTestReceiver(t, f, host)
	if w := push(rc, f.JWE); w.Code != http.StatusNoContent {
		t.Fatalf("code = %d %s", w.Code, w.Body)
	}
	if !strings.Contains(string(host.applied), "USER_JWT="+f.Bundle["USER_JWT"]+"\n") || host.selfChck != 1 {
		t.Fatalf("applied %q, self-checks %d", host.applied, host.selfChck)
	}
	if ReadState(rc.StateFile).LastIat != f.Iat {
		t.Fatal("iat not recorded")
	}
	// The key is one-time: the very same push is now refused.
	if w := push(rc, f.JWE); w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "unknown or used key") {
		t.Fatalf("replay: %d %s", w.Code, w.Body)
	}
}

func TestPushRefusals(t *testing.T) {
	f := load(t)
	rc := newTestReceiver(t, f, &hostFake{addrs: "10.0.0.2/24\n"})
	if w := push(rc, f.JWE); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "host mismatch") {
		t.Fatalf("host: %d %s", w.Code, w.Body)
	}

	rc = newTestReceiver(t, f, &hostFake{addrs: "203.0.113.7/24\n"})
	_ = os.WriteFile(rc.StateFile, []byte(`{"lastIat":`+jsonInt(f.Iat)+`}`), 0o644)
	if w := push(rc, f.JWE); w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "stale bundle") {
		t.Fatalf("stale: %d %s", w.Code, w.Body)
	}

	w := httptest.NewRecorder()
	rc.HandlePush(w, httptest.NewRequest(http.MethodGet, "/api/identity/push", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET push: %d", w.Code)
	}
	w = httptest.NewRecorder()
	rc.HandlePush(w, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"jwe":"`+strings.Repeat("a", MaxBody)+`"}`)))
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize: %d", w.Code)
	}
	for i := 0; i < 20; i++ {
		w = push(rc, "x")
	}
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("rate limit: %d", w.Code)
	}
}

func jsonInt(i int64) string { b, _ := json.Marshal(i); return string(b) }

func TestKeyRoute(t *testing.T) {
	rc := NewReceiver(&Receiver{Keys: NewKeyStore()})
	w := httptest.NewRecorder()
	rc.HandleKey(w, httptest.NewRequest(http.MethodGet, "/api/identity/key", nil))
	var k IssuedKey
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &k) != nil || k.JWK.Crv != "X25519" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("key route: %d %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), `"d"`) {
		t.Fatal("private component served")
	}
}
