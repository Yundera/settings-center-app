// Package config reads the admin app's settings from the environment.
package config

import (
	"net"
	"net/url"
	"os"
	"path"
	"strings"
)

type Config struct {
	// Addr is the listen address. The AppShield gate (`admin`) is the only thing
	// meant to talk to it, over the pcs network; its BACKEND_PORT is 80.
	Addr string

	// YunderaDir is the Yundera root (/DATA/AppData/yundera) as mounted
	// READ-ONLY inside this container: .env, .pcs.env, log/, template/. Reads go
	// through here; every write is a host verb.
	YunderaDir string
	// YunderaHostRoot is the same directory as the HOST sees it. Host verbs run
	// in the host's mount namespace, so they need this path, not YunderaDir.
	YunderaHostRoot string
	// DataDir is the app's own writable state (identity-state.json).
	DataDir string

	// AssertionSecret verifies the gate's X-AppShield-Assertion. Empty means
	// every authenticated request is refused — there is no open mode.
	AssertionSecret string
	// AssertionAudience must match the gate's APP_NAME (`admin`).
	AssertionAudience string
	// GateURL is the gate's control API, for revoking sessions.
	GateURL string

	// DevIdentity lets a developer run the UI without a gate. Honoured only when
	// AssertionSecret is empty AND Env is "development".
	DevIdentity string
	Env         string

	// SelfContainer names this container, so the runner is created from the
	// exact image this process runs from. RunnerImage overrides the lookup.
	SelfContainer string
	RunnerImage   string

	// Box identity, from the container env (the compose file passes them).
	Domain   string
	UID      string
	PublicIP string

	// OperatorAPI is the Yundera control plane (…/service/pcs): the support key,
	// the default identity issuer and the subscription dashboard derive from it.
	OperatorAPI string

	SMTPAddr      string
	SupportEmail  string
	FeedbackToken string
	FeedbackEmail string

	// OnboardingCheckToken authenticates Maison's GET /api/onboarding/check
	// (its managed `onboarding` setting carries the same secret). Empty ⇒ 404.
	OnboardingCheckToken string

	// UpstreamLogoutURL ends the local-account (Authelia) session on logout,
	// before the gate's own logout.
	UpstreamLogoutURL string
}

// DefaultOperatorAPI is production Yundera.
const DefaultOperatorAPI = "https://app.yundera.com/service/pcs"

// DefaultSupportEmail receives support reports and feedback when nothing else
// is configured.
const DefaultSupportEmail = "support@yundera.com"

func FromEnv() Config {
	return Config{
		Addr:                 def(os.Getenv("LISTEN_ADDR"), ":80"),
		YunderaDir:           def(os.Getenv("YUNDERA_DIR"), "/yundera"),
		YunderaHostRoot:      strings.TrimRight(def(os.Getenv("COMPOSE_FOLDER_PATH"), "/DATA/AppData/yundera"), "/"),
		DataDir:              def(os.Getenv("DATA_DIR"), "/app/data"),
		AssertionSecret:      strings.TrimSpace(os.Getenv("IDENTITY_ASSERTION_SECRET")),
		AssertionAudience:    def(os.Getenv("IDENTITY_ASSERTION_AUDIENCE"), "admin"),
		GateURL:              strings.TrimRight(def(os.Getenv("APPSHIELD_GATE_URL"), "http://admin"), "/"),
		DevIdentity:          strings.TrimSpace(os.Getenv("DEV_IDENTITY")),
		Env:                  def(os.Getenv("ADMIN_ENV"), "production"),
		SelfContainer:        def(os.Getenv("SELF_CONTAINER"), "admin-app"),
		RunnerImage:          strings.TrimSpace(os.Getenv("RUNNER_IMAGE")),
		Domain:               strings.TrimSpace(os.Getenv("DOMAIN")),
		UID:                  strings.TrimSpace(os.Getenv("UID")),
		PublicIP:             strings.TrimSpace(os.Getenv("PUBLIC_IP")),
		OperatorAPI:          strings.TrimRight(def(os.Getenv("OPERATOR_API"), DefaultOperatorAPI), "/"),
		SMTPAddr:             net.JoinHostPort(def(os.Getenv("SMTP_HOST"), "smtp"), def(os.Getenv("SMTP_PORT"), "587")),
		SupportEmail:         strings.TrimSpace(os.Getenv("SUPPORT_EMAIL")),
		FeedbackToken:        strings.TrimSpace(os.Getenv("FEEDBACK_TOKEN")),
		FeedbackEmail:        strings.TrimSpace(os.Getenv("FEEDBACK_EMAIL")),
		OnboardingCheckToken: strings.TrimSpace(os.Getenv("ONBOARDING_CHECK_TOKEN")),
		UpstreamLogoutURL:    strings.TrimSpace(os.Getenv("UPSTREAM_LOGOUT_URL")),
	}
}

func def(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return strings.TrimSpace(v)
}

// HostScripts is the template's scripts directory as the HOST sees it. The
// tree moved to template/scripts; boxes that have not run that migration still
// keep it at scripts/, so the read-only mount decides which one exists.
func (c Config) HostScripts() string {
	if st, err := os.Stat(path.Join(c.YunderaDir, "template", "scripts")); err == nil && st.IsDir() {
		return path.Join(c.YunderaHostRoot, "template", "scripts")
	}
	return path.Join(c.YunderaHostRoot, "scripts")
}

// HostPath maps a path under the Yundera root to the host's view of it.
func (c Config) HostPath(rel string) string { return path.Join(c.YunderaHostRoot, rel) }

// LocalPath maps a path under the Yundera root to this container's read-only view.
func (c Config) LocalPath(rel string) string { return path.Join(c.YunderaDir, rel) }

// RecipientSupport is where support reports go.
func (c Config) RecipientSupport() string {
	if c.SupportEmail != "" {
		return c.SupportEmail
	}
	return DefaultSupportEmail
}

// RecipientFeedback is where Maison's feedback goes.
func (c Config) RecipientFeedback() string {
	if c.FeedbackEmail != "" {
		return c.FeedbackEmail
	}
	return c.RecipientSupport()
}

// DashboardURL is the Yundera customer dashboard (subscription, billing):
// the control plane's origin + /dashboard, so a staging box links to staging.
func (c Config) DashboardURL() string {
	u, err := url.Parse(c.OperatorAPI)
	if err != nil || u.Host == "" {
		return "https://app.yundera.com/dashboard"
	}
	return u.Scheme + "://" + u.Host + "/dashboard"
}
