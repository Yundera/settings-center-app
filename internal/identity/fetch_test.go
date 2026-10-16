package identity

import (
	"context"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// orchestrator stands in for POST /identity/doorbell: it answers a body
// carrying a one-time key with the fixture's JWE (encrypted to that key by the
// orchestrator's own code), and anything else with 204.
func orchestrator(t *testing.T, f fixture, status int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/service/pcs/identity/doorbell" {
			http.NotFound(w, r)
			return
		}
		var k IssuedKey
		if err := json.NewDecoder(r.Body).Decode(&k); err != nil || k.Kid != f.BoxKid || k.JWK.Crv != "X25519" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"jwe": f.JWE})
	}))
}

func fetcher(t *testing.T, f fixture, addrs map[string]bool) *Fetcher {
	box := f.boxKey(t)
	ks := NewKeyStore()
	return &Fetcher{
		HTTP:   http.DefaultClient,
		Keys:   ks,
		Issuer: f.Issuer,
		Lookup: func(_ context.Context, kid string) (*rsa.PublicKey, error) {
			if kid != "sig-1" {
				return nil, errors.New("no matching key")
			}
			return f.rsaKey(t), nil
		},
		Now:   f.at,
		Addrs: func() (map[string]bool, error) { return addrs, nil },
		issue: func() (IssuedKey, error) {
			ks.put(f.BoxKid, box)
			return IssuedKey{Kid: f.BoxKid, JWK: PublicJWK{Kty: "OKP", Crv: "X25519", X: b64.EncodeToString(box.PublicKey().Bytes())}}, nil
		},
	}
}

func TestFetchReply(t *testing.T) {
	f := load(t)
	srv := orchestrator(t, f, http.StatusOK)
	defer srv.Close()

	v, err := fetcher(t, f, map[string]bool{f.Host: true}).Fetch(context.Background(), srv.URL+"/service/pcs/")
	if err != nil {
		t.Fatal(err)
	}
	for k, want := range f.Bundle {
		if v.Bundle[k] != want {
			t.Errorf("%s = %q, want %q", k, v.Bundle[k], want)
		}
	}
}

func TestFetchRefusals(t *testing.T) {
	f := load(t)

	srv := orchestrator(t, f, http.StatusNoContent)
	defer srv.Close()
	if _, err := fetcher(t, f, map[string]bool{f.Host: true}).Fetch(context.Background(), srv.URL+"/service/pcs"); !errors.Is(err, ErrNoReply) {
		t.Fatalf("204: err = %v, want ErrNoReply", err)
	}

	ok := orchestrator(t, f, http.StatusOK)
	defer ok.Close()
	_, err := fetcher(t, f, map[string]bool{"10.0.0.9": true}).Fetch(context.Background(), ok.URL+"/service/pcs")
	var rej Rejected
	if !errors.As(err, &rej) {
		t.Fatalf("other host: err = %v, want a host-mismatch rejection", err)
	}

	// The key is one-time: a second open of the same reply finds nothing.
	fe := fetcher(t, f, map[string]bool{f.Host: true})
	if _, err := fe.Fetch(context.Background(), ok.URL+"/service/pcs"); err != nil {
		t.Fatal(err)
	}
	if fe.Keys.Take(f.BoxKid) != nil {
		t.Fatal("the one-time key survived the fetch")
	}
}
