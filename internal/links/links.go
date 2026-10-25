// Package links derives the addresses of this box's other consoles from the
// host the browser used to reach this one.
//
// Every console on a PCS is `<prefix>-<base>`, where <base> is the domain
// (alice.nsl.sh) or the dashed public IP under ip.<zone>, nip.io or sslip.io. The prefixes
// are literals in each stack's caddy labels, never env, so swapping `admin-`
// for another prefix is the one rule that works for all three host forms — the
// same trick v1's forwardMovedPanels used.
package links

import (
	"net"
	"regexp"
	"strings"
)

type Links struct {
	Base          string `json:"base"`
	Root          string `json:"root"`
	Maison        string `json:"maison"`
	MaisonBackups string `json:"maisonBackups"`
	Kopia         string `json:"kopia"`
	AuthConsole   string `json:"authConsole"`
	AuthAccess    string `json:"authAccess"`
	MeshConsole   string `json:"meshConsole"`
	MeshDomain    string `json:"meshDomain"`
	Dashboard     string `json:"dashboard"`
}

var hostRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$`)

// Base returns the box base for host, or fallback when host is not one of
// ours (a direct hit on admin-app over pcs, a dev run on localhost).
func Base(host, fallback string) string {
	h := strings.ToLower(strings.TrimSpace(host))
	if hh, _, err := net.SplitHostPort(h); err == nil {
		h = hh
	}
	if b, ok := strings.CutPrefix(h, "admin-"); ok && hostRe.MatchString(b) && strings.Contains(b, ".") {
		return b
	}
	return strings.ToLower(fallback)
}

func For(base, dashboard string) Links {
	sub := func(prefix string) string { return "https://" + prefix + "-" + base }
	return Links{
		Base:          base,
		Root:          "https://" + base,
		Maison:        sub("maison"),
		MaisonBackups: sub("maison") + "/settings/backups",
		Kopia:         sub("kopia"),
		AuthConsole:   sub("auth-console"),
		AuthAccess:    sub("auth-console") + "/access",
		MeshConsole:   sub("mesh-console"),
		MeshDomain:    sub("mesh-console") + "/domain",
		Dashboard:     dashboard,
	}
}
