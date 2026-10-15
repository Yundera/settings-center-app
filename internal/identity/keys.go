// Package identity receives the identity the Yundera control plane pushes to
// this box: its USER_JWT, PROVIDER_STR, UID, DOMAIN, DOMAIN_UID and EMAIL
// (pcs-orchestrator doc/identity-push.md, "Wire contract").
//
// The two routes are public — a box that lost every credential must still be
// reachable — so the bundle authenticates itself. It must decrypt with a
// one-time key this process just issued, be an RS256 `pcs-identity+jwt`
// signed by the trusted issuer, name an address of this machine as `host`, and
// be newer than the last bundle applied. Only then is anything written, by the
// template's tools/apply-identity.sh with the values on stdin.
//
// Port of v1's backend/identity/*, same status codes and reasons.
package identity

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// One-time X25519 keys. Each lives in memory only, decrypts at most one push,
// and expires after KeyTTL — the box keeps no secret of its own. The store is
// bounded: a flood of key requests can only evict other unused keys.
const (
	KeyTTL  = 2 * time.Minute
	MaxKeys = 16
)

type PublicJWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
}

type IssuedKey struct {
	Kid string    `json:"kid"`
	JWK PublicJWK `json:"jwk"`
}

type keyEntry struct {
	kid     string
	priv    *ecdh.PrivateKey
	expires time.Time
}

type KeyStore struct {
	mu   sync.Mutex
	keys []keyEntry // insertion order: oldest first
	now  func() time.Time
}

func NewKeyStore() *KeyStore { return &KeyStore{now: time.Now} }

func (s *KeyStore) Issue() (IssuedKey, error) {
	priv, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return IssuedKey{}, err
	}
	kid := uuid()
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	live := s.keys[:0]
	for _, k := range s.keys {
		if k.expires.After(now) {
			live = append(live, k)
		}
	}
	for len(live) >= MaxKeys {
		live = live[1:]
	}
	s.keys = append(live, keyEntry{kid: kid, priv: priv, expires: now.Add(KeyTTL)})
	return IssuedKey{Kid: kid, JWK: PublicJWK{Kty: "OKP", Crv: "X25519", X: b64.EncodeToString(priv.PublicKey().Bytes())}}, nil
}

// Take returns and forgets the key a push names: nil if unknown, used or
// expired.
func (s *KeyStore) Take(kid string) *ecdh.PrivateKey {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, k := range s.keys {
		if k.kid == kid {
			s.keys = append(s.keys[:i:i], s.keys[i+1:]...)
			if !k.expires.After(s.now()) {
				return nil
			}
			return k.priv
		}
	}
	return nil
}

// put is for tests: register a known private key under kid.
func (s *KeyStore) put(kid string, priv *ecdh.PrivateKey) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.keys = append(s.keys, keyEntry{kid: kid, priv: priv, expires: s.now().Add(KeyTTL)})
}

func uuid() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// Limiter is a fixed-window counter. Process-wide, not per caller: the routes
// are reached through the gate and the mesh, so the caller address is not
// trustworthy, and the legitimate traffic is a handful of requests a day.
type Limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	start  time.Time
	count  int
	now    func() time.Time
}

func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{max: max, window: window, now: time.Now}
}

func (l *Limiter) Allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if now.Sub(l.start) >= l.window {
		l.start, l.count = now, 0
	}
	l.count++
	return l.count <= l.max
}
