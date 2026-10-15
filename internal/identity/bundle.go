package identity

import (
	"context"
	"crypto/ecdh"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const (
	BundleTyp = "pcs-identity+jwt"
	BundleAud = "pcs-identity"
	maxJWE    = 16384
)

// Rejected is a bundle refused for a reason the operator should record as the
// box's delivery state (400 with the reason).
type Rejected struct{ Reason string }

func (r Rejected) Error() string { return r.Reason }

func reject(format string, a ...any) error { return Rejected{fmt.Sprintf(format, a...)} }

// Keys are the bundle fields, in the order apply-identity.sh is fed them.
var Keys = []string{"UID", "DOMAIN", "EMAIL", "DOMAIN_UID", "USER_JWT", "PROVIDER_STR"}

// Every value ends up in an env file through a shell script, so each one has a
// strict shape: no quotes, whitespace or `$`. EMAIL may legitimately be empty.
var shapes = map[string]*regexp.Regexp{
	"UID":          regexp.MustCompile(`^[A-Za-z0-9_.@-]{1,128}$`),
	"DOMAIN":       regexp.MustCompile(`^[a-z0-9.-]{1,253}$`),
	"EMAIL":        regexp.MustCompile(`^[A-Za-z0-9._%+@-]{0,254}$`),
	"DOMAIN_UID":   regexp.MustCompile(`^[A-Za-z0-9_.@-]{1,200}$`),
	"USER_JWT":     regexp.MustCompile(`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`),
	"PROVIDER_STR": regexp.MustCompile(`^https://[A-Za-z0-9.-]+,[A-Za-z0-9_.@-]+,[A-Za-z0-9]+$`),
}

type Bundle map[string]string

// Lines is the bundle as apply-identity.sh's stdin.
func (b Bundle) Lines() []byte {
	var s strings.Builder
	for _, k := range Keys {
		s.WriteString(k + "=" + b[k] + "\n")
	}
	return []byte(s.String())
}

type Verified struct {
	Host   string
	Iat    int64
	Bundle Bundle
}

// KeyLookup finds the issuer key named kid.
type KeyLookup func(ctx context.Context, kid string) (*rsa.PublicKey, error)

// Open decrypts and verifies a pushed bundle. take is the one-time key lookup;
// keys resolves the issuer's signing key.
func Open(ctx context.Context, jwe string, take func(string) *ecdh.PrivateKey, issuer string, keys KeyLookup, now time.Time) (*Verified, error) {
	if jwe == "" || len(jwe) > maxJWE {
		return nil, reject("bad jwe")
	}
	kid, err := jweKid(jwe)
	if err != nil {
		return nil, reject("bad jwe")
	}
	priv := take(kid)
	if priv == nil {
		return nil, reject("unknown or used key")
	}
	plain, err := decryptJWE(jwe, priv)
	if err != nil {
		return nil, reject("cannot decrypt")
	}

	h, payload, signed, sig, err := splitJWS(string(plain))
	if err != nil {
		return nil, reject("signature: malformed JWS")
	}
	if h.Alg != "RS256" {
		return nil, reject("signature: unexpected alg %q", h.Alg)
	}
	if !strings.EqualFold(strings.TrimPrefix(strings.ToLower(h.Typ), "application/"), BundleTyp) {
		return nil, reject("signature: unexpected \"typ\" JWT header value")
	}
	pub, err := keys(ctx, h.Kid)
	if err != nil {
		// Discovery/JWKS outages are not the bundle's fault: surface as 500.
		if strings.HasPrefix(err.Error(), "no matching key") {
			return nil, reject("signature: %s", err.Error())
		}
		return nil, err
	}
	if err := verifyRS256(pub, signed, sig); err != nil {
		return nil, reject("signature: signature verification failed")
	}

	var c struct {
		Iss    string          `json:"iss"`
		Aud    json.RawMessage `json:"aud"`
		Iat    *float64        `json:"iat"`
		Exp    *float64        `json:"exp"`
		Nbf    *float64        `json:"nbf"`
		Host   any             `json:"host"`
		Bundle any             `json:"bundle"`
	}
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, reject("signature: JWT payload is not JSON")
	}
	if c.Iat == nil {
		return nil, reject("signature: missing required \"iat\" claim")
	}
	if c.Exp == nil {
		return nil, reject("signature: missing required \"exp\" claim")
	}
	if c.Iss != issuer {
		return nil, reject("signature: unexpected \"iss\" claim value")
	}
	if !audIncludes(c.Aud, BundleAud) {
		return nil, reject("signature: unexpected \"aud\" claim value")
	}
	if float64(now.Unix()) >= *c.Exp {
		return nil, reject("signature: \"exp\" claim timestamp check failed")
	}
	if c.Nbf != nil && float64(now.Unix()) < *c.Nbf {
		return nil, reject("signature: \"nbf\" claim timestamp check failed")
	}

	host, ok := c.Host.(string)
	if !ok || len(host) > 64 {
		return nil, reject("bad host")
	}
	raw, ok := c.Bundle.(map[string]any)
	if !ok {
		return nil, reject("bundle missing")
	}
	b := Bundle{}
	for _, k := range Keys {
		v, ok := raw[k].(string)
		if !ok || len(v) > 4096 || !shapes[k].MatchString(v) {
			return nil, reject("bad %s", k)
		}
		b[k] = v
	}
	return &Verified{Host: host, Iat: int64(*c.Iat), Bundle: b}, nil
}

func audIncludes(raw json.RawMessage, want string) bool {
	var one string
	if json.Unmarshal(raw, &one) == nil {
		return one == want
	}
	var many []string
	if json.Unmarshal(raw, &many) == nil {
		for _, a := range many {
			if a == want {
				return true
			}
		}
	}
	return false
}
