package identity

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// Fetch asks the operator for this box's identity instead of waiting for a
// push: the doorbell with a one-time key in the body, answered with the same
// bundle a push carries, encrypted to that key (pcs-orchestrator
// doc/identity-push.md, "Doorbell reply"). It is how a box gets its identity
// before anything on it can receive a push — during provisioning, before
// Caddy and this app are up — and the self-check's fallback when a push does
// not land.
//
// The bundle is checked exactly as a pushed one (Open), and its `host` must
// be an address of this machine, so the command runs in the host's network
// namespace (docker run --network host).

// ErrNoReply is an operator that answered without an identity: it knows no
// PCS at this address, refused, or predates replies (always 204).
var ErrNoReply = errors.New("the operator answered without an identity")

type Fetcher struct {
	HTTP   *http.Client
	Keys   *KeyStore
	Lookup KeyLookup
	Issuer string
	Now    func() time.Time
	// Addrs lists this machine's addresses; LocalAddrs by default.
	Addrs func() (map[string]bool, error)

	// issue hands out the one-time key; Keys.Issue unless a test sets it.
	issue func() (IssuedKey, error)
}

// IPv4Client dials over IPv4 only. The operator matches the caller's address
// against the host's public IPv4; a reply asked for over IPv6 would find no
// PCS.
func IPv4Client(timeout time.Duration) *http.Client {
	d := &net.Dialer{Timeout: 10 * time.Second}
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.DialContext = func(ctx context.Context, _, addr string) (net.Conn, error) {
		return d.DialContext(ctx, "tcp4", addr)
	}
	return &http.Client{Timeout: timeout, Transport: t}
}

// LocalAddrs is every address on this machine's interfaces.
func LocalAddrs() (map[string]bool, error) {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil, err
	}
	out := map[string]bool{}
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok {
			out[ipn.IP.String()] = true
		}
	}
	return out, nil
}

func (f *Fetcher) Fetch(ctx context.Context, operatorAPI string) (*Verified, error) {
	issue := f.issue
	if issue == nil {
		issue = f.Keys.Issue
	}
	now, addrs := f.Now, f.Addrs
	if now == nil {
		now = time.Now
	}
	if addrs == nil {
		addrs = LocalAddrs
	}

	k, err := issue()
	if err != nil {
		return nil, err
	}
	body, _ := json.Marshal(k)
	url := strings.TrimRight(operatorAPI, "/") + "/identity/doorbell"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := f.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("doorbell: %w", err)
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case http.StatusOK:
	case http.StatusNoContent:
		return nil, ErrNoReply
	default:
		return nil, fmt.Errorf("doorbell: %s returned %d", url, res.StatusCode)
	}
	var reply struct {
		JWE string `json:"jwe"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, MaxBody)).Decode(&reply); err != nil {
		return nil, fmt.Errorf("doorbell: unreadable reply: %w", err)
	}

	v, err := Open(ctx, reply.JWE, f.Keys.Take, f.Issuer, f.Lookup, now())
	if err != nil {
		return nil, err
	}
	local, err := addrs()
	if err != nil {
		return nil, fmt.Errorf("cannot list this machine's addresses: %w", err)
	}
	if !local[v.Host] {
		return nil, Rejected{fmt.Sprintf("host mismatch: the bundle is for %s", v.Host)}
	}
	return v, nil
}
