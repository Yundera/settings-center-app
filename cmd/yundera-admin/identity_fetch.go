package main

import (
	"context"
	"crypto/rsa"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/yundera/settings-center-app/internal/config"
	"github.com/yundera/settings-center-app/internal/identity"
)

// Exit codes of `yundera-admin identity-fetch`, read by template-root's
// ensure-yundera-user-data.sh.
const (
	fetchOK      = 0
	fetchFailed  = 1
	fetchNoReply = 3
)

// identityFetch is `yundera-admin identity-fetch [--api URL] [--issuer URL]`:
// ring the doorbell with a one-time key and print the verified identity as
// apply-identity.sh's stdin (KEY=VALUE lines). Nothing is written here — the
// template pipes it into apply-identity.sh. Run it in the host's network
// namespace: the bundle must name one of this machine's addresses.
func identityFetch(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("identity-fetch", flag.ContinueOnError)
	fs.SetOutput(stderr)
	api := fs.String("api", config.DefaultOperatorAPI, "operator base URL (OPERATOR_API)")
	trustIssuer := fs.String("issuer", "", "trusted issuer (TRUST_ISSUER); default <api>/auth")
	if err := fs.Parse(args); err != nil {
		return fetchFailed
	}

	issuer := identity.Issuer(*trustIssuer, *api)
	trust := identity.NewTrust()
	trust.HTTP = identity.IPv4Client(15 * time.Second)
	f := &identity.Fetcher{
		HTTP:   identity.IPv4Client(30 * time.Second),
		Keys:   identity.NewKeyStore(),
		Issuer: issuer,
		Lookup: func(ctx context.Context, kid string) (*rsa.PublicKey, error) {
			return trust.Key(ctx, issuer, kid)
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	v, err := f.Fetch(ctx, *api)
	if errors.Is(err, identity.ErrNoReply) {
		fmt.Fprintln(stderr, "identity-fetch: no identity in the doorbell's answer (no PCS bound to this address yet, or an operator without replies)")
		return fetchNoReply
	}
	if err != nil {
		fmt.Fprintf(stderr, "identity-fetch: %v\n", err)
		return fetchFailed
	}
	if _, err := stdout.Write(v.Bundle.Lines()); err != nil {
		return fetchFailed
	}
	fmt.Fprintf(stderr, "identity-fetch: identity for %s (iat %d)\n", v.Bundle["DOMAIN"], v.Iat)
	return fetchOK
}

func init() {
	subcommands["identity-fetch"] = func(args []string) int { return identityFetch(args, os.Stdout, os.Stderr) }
}
