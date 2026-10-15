package identity

import (
	"context"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Trust finds the issuer's signing keys: discovery document, then its
// jwks_uri. A kid the cached set does not know triggers one refetch (at most
// every refetchCooldown), so a key rotation needs nothing from the box.
type Trust struct {
	HTTP *http.Client

	mu   sync.Mutex
	sets map[string]*keySet
}

type keySet struct {
	jwksURI   string
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

const refetchCooldown = 30 * time.Second

func NewTrust() *Trust {
	return &Trust{HTTP: &http.Client{Timeout: 10 * time.Second}, sets: map[string]*keySet{}}
}

// Key returns the issuer's RS256 key named kid.
func (t *Trust) Key(ctx context.Context, issuer, kid string) (*rsa.PublicKey, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	set := t.sets[issuer]
	if set == nil {
		uri, err := t.discover(ctx, issuer)
		if err != nil {
			return nil, err
		}
		set = &keySet{jwksURI: uri}
		t.sets[issuer] = set
	}
	if k, ok := set.keys[kid]; ok {
		return k, nil
	}
	if set.keys != nil && time.Since(set.fetchedAt) < refetchCooldown {
		return nil, errors.New("no matching key in the issuer's key set")
	}
	keys, err := t.fetchJWKS(ctx, set.jwksURI)
	if err != nil {
		return nil, err
	}
	set.keys, set.fetchedAt = keys, time.Now()
	if k, ok := keys[kid]; ok {
		return k, nil
	}
	return nil, errors.New("no matching key in the issuer's key set")
}

func (t *Trust) getJSON(ctx context.Context, url string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	res, err := t.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s returned %d", url, res.StatusCode)
	}
	return json.NewDecoder(http.MaxBytesReader(nil, res.Body, 1<<20)).Decode(v)
}

// discover reads the issuer's discovery document. It must describe the issuer
// we trust, or a misrouted URL could hand us someone else's keys.
func (t *Trust) discover(ctx context.Context, issuer string) (string, error) {
	var doc struct {
		Issuer  string `json:"issuer"`
		JWKSURI string `json:"jwks_uri"`
	}
	if err := t.getJSON(ctx, issuer+"/.well-known/openid-configuration", &doc); err != nil {
		return "", fmt.Errorf("issuer discovery: %w", err)
	}
	if strings.TrimRight(doc.Issuer, "/") != issuer || doc.JWKSURI == "" {
		return "", errors.New("issuer discovery does not match the trusted issuer")
	}
	return doc.JWKSURI, nil
}

func (t *Trust) fetchJWKS(ctx context.Context, uri string) (map[string]*rsa.PublicKey, error) {
	var set struct {
		Keys []jwk `json:"keys"`
	}
	if err := t.getJSON(ctx, uri, &set); err != nil {
		return nil, fmt.Errorf("issuer key set: %w", err)
	}
	out := map[string]*rsa.PublicKey{}
	for _, k := range set.Keys {
		if k.Use != "" && k.Use != "sig" || k.Alg != "" && k.Alg != "RS256" {
			continue
		}
		if pub, err := k.rsaPublic(); err == nil {
			out[k.Kid] = pub
		}
	}
	return out, nil
}

// Issuer is TRUST_ISSUER from .pcs.env when set, otherwise the operator's own
// login IdP: ${OPERATOR_API}/auth. Deriving it means a staging box trusts
// staging and a prod box trusts prod with nothing to configure.
func Issuer(trustIssuer, operatorAPI string) string {
	if v := strings.TrimRight(strings.TrimSpace(trustIssuer), "/"); v != "" {
		return v
	}
	return strings.TrimRight(operatorAPI, "/") + "/auth"
}
