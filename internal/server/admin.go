package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/yundera/settings-center-app/internal/auth"
	"github.com/yundera/settings-center-app/internal/envfile"
	"github.com/yundera/settings-center-app/internal/features"
	"github.com/yundera/settings-center-app/internal/gatectl"
	"github.com/yundera/settings-center-app/internal/hostrun"
	"github.com/yundera/settings-center-app/internal/hostverb"
	"github.com/yundera/settings-center-app/internal/identity"
	"github.com/yundera/settings-center-app/internal/links"
	"github.com/yundera/settings-center-app/internal/mail"
	"github.com/yundera/settings-center-app/internal/onboarding"
	"github.com/yundera/settings-center-app/internal/selfcheck"
	"github.com/yundera/settings-center-app/internal/status"
	"github.com/yundera/settings-center-app/internal/support"
)

// ---- who and where ---------------------------------------------------------

// domain is the box's domain, fresh from .ynd.user.env (an identity push may
// have changed it since this container started), else the container env.
func (s *Server) domain() string {
	if env, err := envfile.Load(s.cfg.LocalPath(".ynd.user.env")); err == nil {
		if d := env.Get("DOMAIN"); d != "" {
			return d
		}
	}
	return s.cfg.Domain
}

func (s *Server) links(r *http.Request) links.Links {
	return links.For(links.Base(r.Host, s.domain()), s.cfg.DashboardURL())
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.FromContext(r.Context())
	role := "user"
	if id.IsAdmin() {
		role = "admin"
	}
	name := id.Name
	if name == "" {
		name = id.User
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]string{
			"id": id.User, "fullName": name, "email": id.Email, "role": role, "provider": id.Method,
		},
		"upstreamLogoutUrl": s.cfg.UpstreamLogoutURL,
		"version":           Version,
		"domain":            s.domain(),
		"links":             s.links(r),
	})
}

// ---- overview ----------------------------------------------------------------

const featureCacheTTL = time.Minute

func (s *Server) cachedFeatures(ctx context.Context) []features.State {
	s.featMu.Lock()
	if s.featCache != nil && time.Since(s.featAt) < featureCacheTTL {
		out := s.featCache
		s.featMu.Unlock()
		return out
	}
	s.featMu.Unlock()
	out := s.features.All(ctx)
	s.featMu.Lock()
	s.featCache, s.featAt = out, time.Now()
	s.featMu.Unlock()
	return out
}

func (s *Server) dropFeatureCache() {
	s.featMu.Lock()
	s.featCache = nil
	s.featMu.Unlock()
}

func featureOn(list []features.State, id string) *bool {
	for _, f := range list {
		if f.ID == id {
			return f.Enabled
		}
	}
	return nil
}

// hostTime parses a log timestamp in the host's zone (/etc/localtime is
// mounted; tzdata ships in the image).
func hostTime(s *string) time.Time {
	if s == nil {
		return time.Time{}
	}
	t, err := time.ParseInLocation("2006-01-02T15:04:05", *s, time.Local)
	if err != nil {
		return time.Time{}
	}
	return t
}

// staleRun: an unfinished run whose start is older than this is not "running"
// any more — it died without a completion line (a reboot mid-run).
const staleRun = 2 * time.Hour

func (s *Server) selfCheckFacts() (latest, completed *selfcheck.Run, running bool, err error) {
	text, err := selfcheck.TailLines(s.cfg.LocalPath("log/yundera.log"), 4000)
	if err != nil {
		return nil, nil, false, err
	}
	runs := selfcheck.Parse(text)
	if len(runs) > 0 {
		latest = runs[len(runs)-1]
	}
	for i := len(runs) - 1; i >= 0; i-- {
		if runs[i].Status != selfcheck.RunRunning {
			completed = runs[i]
			break
		}
	}
	if latest != nil && latest.Status == selfcheck.RunRunning {
		st := hostTime(latest.StartedAt)
		running = st.IsZero() || time.Since(st) < staleRun
	}
	return latest, completed, running, nil
}

// tokenExpiry reads USER_JWT's exp from .pcs.secret.env. Only the claim is
// decoded; the token itself never leaves this function.
func (s *Server) tokenExpiry() time.Time {
	env, err := envfile.Load(s.cfg.LocalPath(".pcs.secret.env"))
	if err != nil {
		return time.Time{}
	}
	parts := strings.Split(env.Get("USER_JWT"), ".")
	if len(parts) != 3 {
		return time.Time{}
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Time{}
	}
	var c struct {
		Exp float64 `json:"exp"`
	}
	if json.Unmarshal(raw, &c) != nil || c.Exp == 0 {
		return time.Time{}
	}
	return time.Unix(int64(c.Exp), 0)
}

func (s *Server) templateSyncedAt() time.Time {
	raw, err := os.ReadFile(s.cfg.LocalPath("template/.revision.json"))
	if err != nil {
		return time.Time{}
	}
	var rev struct {
		SyncedAt time.Time `json:"synced_at"`
	}
	_ = json.Unmarshal(raw, &rev)
	return rev.SyncedAt
}

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	in := status.Inputs{Now: time.Now()}

	_, completed, running, _ := s.selfCheckFacts()
	in.SelfCheck.Running = running
	if completed != nil {
		ok := completed.Status == selfcheck.RunSuccess
		in.SelfCheck.Completed = &ok
		in.SelfCheck.EndedAt = hostTime(completed.EndedAt)
		in.SelfCheck.Passed, in.SelfCheck.Total = completed.Passed, completed.Total
		for _, sc := range completed.Scripts {
			if sc.Status == selfcheck.ScriptFailed {
				in.SelfCheck.Failed = append(in.SelfCheck.Failed, sc.Name)
			}
		}
	}

	feats := s.cachedFeatures(ctx)
	pcs := s.pcsEnv()
	in.Updates = status.Updates{Enabled: featureOn(feats, "platform-updates"), Channel: status.Channel(pcs.Get("UPDATE_URL")), SyncedAt: s.templateSyncedAt()}
	st := identity.ReadState(filepath.Join(s.cfg.DataDir, "identity-state.json"))
	if t, err := time.Parse(time.RFC3339, st.AppliedAt); err == nil {
		in.Identity.AppliedAt = t
	}
	in.Identity.TokenExpiry = s.tokenExpiry()
	if root := s.metrics.Latest().Root(); root != nil {
		in.Storage = status.Storage{Known: true, SizeBytes: root.SizeBytes, UsedBytes: root.UsedBytes, AvailBytes: root.AvailBytes}
	}
	in.Support = featureOn(feats, "support-key")

	publicIP := pcs.Get("PUBLIC_IP")
	if publicIP == "" {
		publicIP = s.cfg.PublicIP
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"domain":   s.domain(),
		"publicIp": publicIP,
		"version":  Version,
		"links":    s.links(r),
		"summary":  status.Compute(in),
		"running":  running,
	})
}

// ---- health check -------------------------------------------------------------

func intParam(r *http.Request, name string, def, max int) int {
	n, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil || n <= 0 {
		return def
	}
	return min(n, max)
}

func (s *Server) handleSelfCheck(w http.ResponseWriter, r *http.Request) {
	latest, _, running, err := s.selfCheckFacts()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "log_unreadable", "cannot read the self-check log: "+err.Error())
		return
	}
	if latest != nil {
		// Output of scripts that passed is noise under the UI's poll.
		for _, sc := range latest.Scripts {
			if sc.Status == selfcheck.ScriptSuccess {
				sc.Output, sc.OutputTruncated = []string{}, false
			}
		}
		if latest.Status == selfcheck.RunRunning && !running {
			latest.Status = "interrupted"
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": latest, "running": running})
}

func (s *Server) handleSelfCheckLog(w http.ResponseWriter, r *http.Request) {
	n := intParam(r, "lines", 300, 5000)
	text, err := selfcheck.TailLines(s.cfg.LocalPath("log/yundera.log"), n)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "log_unreadable", "cannot read the self-check log: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"log": text, "lines": n})
}

func (s *Server) handleSelfCheckRun(w http.ResponseWriter, r *http.Request) {
	spec, err := hostverb.SelfCheck(s.paths())
	if err == nil {
		_, err = s.run.Run(bg(r), spec)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "host_action_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "started"})
}

const defaultSchedule = "0 3 * * *"

func (s *Server) handleScheduleGet(w http.ResponseWriter, _ *http.Request) {
	v := s.pcsEnv().Get("SELF_CHECK_CRON")
	eff := v
	if eff == "" {
		eff = defaultSchedule
	}
	writeJSON(w, http.StatusOK, map[string]string{"value": v, "effective": eff, "default": defaultSchedule})
}

func (s *Server) handleScheduleSet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Value string `json:"value"`
	}
	if !decode(w, r, &body) {
		return
	}
	spec, err := hostverb.SetEnv(s.paths(), "SELF_CHECK_CRON", body.Value)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_schedule", err.Error())
		return
	}
	if err := s.runOK(bg(r), spec); err != nil {
		writeError(w, http.StatusInternalServerError, "host_action_failed", err.Error())
		return
	}
	ens, _ := hostverb.EnsureNightly(s.paths())
	if err := s.runOK(bg(r), ens); err != nil {
		writeError(w, http.StatusInternalServerError, "host_action_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "value": strings.TrimSpace(body.Value)})
}

func (s *Server) runOK(ctx context.Context, spec hostrun.Spec) error {
	res, err := s.run.Run(ctx, spec)
	if err != nil {
		return err
	}
	return res.Err()
}

func (s *Server) handleChannelGet(w http.ResponseWriter, _ *http.Request) {
	v := s.pcsEnv().Get("UPDATE_URL")
	writeJSON(w, http.StatusOK, map[string]any{"updateUrl": v, "channel": status.Channel(v)})
}

func (s *Server) handleChannelSet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UpdateURL string `json:"updateUrl"`
	}
	if !decode(w, r, &body) {
		return
	}
	spec, err := hostverb.SetEnv(s.paths(), "UPDATE_URL", body.UpdateURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_update_url", err.Error())
		return
	}
	if err := s.runOK(bg(r), spec); err != nil {
		writeError(w, http.StatusInternalServerError, "host_action_failed", err.Error())
		return
	}
	s.dropFeatureCache()
	// Apply now rather than at 03:00: the self-check syncs from the new channel.
	if sc, err := hostverb.SelfCheck(s.paths()); err == nil {
		_, _ = s.run.Run(bg(r), sc)
	}
	writeJSON(w, http.StatusOK, map[string]any{"updateUrl": strings.TrimSpace(body.UpdateURL), "channel": status.Channel(body.UpdateURL)})
}

// ---- features ----------------------------------------------------------------

func (s *Server) handleFeaturesGet(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	list := s.features.All(ctx)
	s.featMu.Lock()
	s.featCache, s.featAt = list, time.Now()
	s.featMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"features": list})
}

func (s *Server) handleFeaturesSet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID      string `json:"id"`
		Enabled *bool  `json:"enabled"`
	}
	if !decode(w, r, &body) {
		return
	}
	if _, ok := hostverb.FeatureScripts[body.ID]; !ok {
		writeError(w, http.StatusBadRequest, "unknown_feature", "body must include a known feature { id }")
		return
	}
	if body.Enabled == nil {
		writeError(w, http.StatusBadRequest, "bad_request", "body must include { enabled: boolean }")
		return
	}
	ctx := bg(r)
	if !*body.Enabled {
		st, err := s.onboard.Status(ctx)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "host_action_failed", features.Describe(err))
			return
		}
		if err := s.features.CheckDisable(ctx, body.ID, st.Claimed); err != nil {
			g, _ := features.IsGuard(err)
			writeError(w, http.StatusConflict, "guard_"+g.Code, err.Error())
			return
		}
	}
	s.dropFeatureCache()
	state, err := s.features.Set(ctx, body.ID, *body.Enabled)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "feature_toggle_failed", features.Describe(err))
		return
	}
	writeJSON(w, http.StatusOK, state)
}

// ---- onboarding ----------------------------------------------------------------

func (s *Server) handleOnboardingStatus(w http.ResponseWriter, r *http.Request) {
	st, err := s.onboard.Status(bg(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "host_action_failed", onboarding.Describe(err))
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleOnboardingClaim(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username    string `json:"username"`
		Displayname string `json:"displayname"`
		Password    string `json:"password"`
		Generate    bool   `json:"generate"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !hostverb.UsernameRe.MatchString(body.Username) {
		writeError(w, http.StatusBadRequest, "invalid_username", "username must start with a lowercase letter or underscore and contain only lowercase letters, digits, - or _ (max 32)")
		return
	}
	if err := hostverb.ValidateDisplayname(strings.TrimSpace(body.Displayname)); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_displayname", err.Error())
		return
	}
	if !body.Generate {
		if err := hostverb.ValidatePassword(body.Password); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_password", err.Error())
			return
		}
	}
	res, err := s.onboard.Claim(bg(r), body.Username, body.Displayname, body.Password, body.Generate)
	if err != nil {
		if onboarding.IsAlreadyClaimed(err) {
			writeError(w, http.StatusConflict, "already_claimed", onboarding.Describe(err))
			return
		}
		writeError(w, http.StatusInternalServerError, "host_action_failed", onboarding.Describe(err))
		return
	}
	s.dropFeatureCache()
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleOnboardingComplete(w http.ResponseWriter, r *http.Request) {
	if err := s.onboard.MarkCompleted(bg(r)); err != nil {
		writeError(w, http.StatusInternalServerError, "host_action_failed", onboarding.Describe(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"completed": true})
}

func (s *Server) handleOnboardingReset(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Confirm bool `json:"confirm"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !body.Confirm {
		writeError(w, http.StatusBadRequest, "confirm_required", `resetting onboarding disables every local account on this server; send {"confirm": true}`)
		return
	}
	ctx := bg(r)
	login, err := s.features.Get(ctx, "yundera-login")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "host_action_failed", "could not check Yundera Login: "+features.Describe(err))
		return
	}
	if !login {
		// After a reset Yundera Login is the only way back to the wizard.
		writeError(w, http.StatusConflict, "login_off", "Yundera Login is off; enable it first (Yundera features), or reset from a terminal: onboarding.sh reset --confirm")
		return
	}
	res, err := s.onboard.Reset(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "host_action_failed", onboarding.Describe(err))
		return
	}
	out := map[string]any{"claimed": res.Claimed, "completed": res.Completed, "username": res.Username, "backup": res.Backup}
	sel := gatectl.Selector{All: true}
	if own := auth.SessionID(r); own != "" {
		sel.Except = []string{own}
	}
	if _, ok := s.gate.Revoke(ctx, sel); !ok {
		out["warning"] = "sessions_not_revoked"
	}
	s.dropFeatureCache()
	writeJSON(w, http.StatusOK, out)
}

// ---- support ---------------------------------------------------------------------

func (s *Server) supportState(ctx context.Context) (map[string]any, error) {
	a, err := s.support.Status(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"ensure":        !support.EnsureOptedOut(s.pcsEnv().Get("ENSURE_SUPPORT_KEY")),
		"accessEnabled": a.Enabled,
		"username":      a.Username,
		"fingerprint":   a.Fingerprint,
		"comment":       a.Comment,
	}, nil
}

func (s *Server) handleSupportGet(w http.ResponseWriter, r *http.Request) {
	out, err := s.supportState(bg(r))
	if err != nil {
		writeError(w, http.StatusBadGateway, "support_unavailable", features.Describe(err))
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleSupportSet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Ensure *bool `json:"ensure"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Ensure == nil {
		writeError(w, http.StatusBadRequest, "bad_request", "body must include { ensure: boolean }")
		return
	}
	ctx := bg(r)
	if !*body.Ensure {
		st, err := s.onboard.Status(ctx)
		if err == nil {
			if err := s.features.CheckDisable(ctx, "support-key", st.Claimed); err != nil {
				g, _ := features.IsGuard(err)
				writeError(w, http.StatusConflict, "guard_"+g.Code, err.Error())
				return
			}
		}
	}
	s.dropFeatureCache()
	if _, err := s.features.Set(ctx, "support-key", *body.Ensure); err != nil {
		writeError(w, http.StatusInternalServerError, "feature_toggle_failed", features.Describe(err))
		return
	}
	out, err := s.supportState(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, "support_unavailable", features.Describe(err))
		return
	}
	writeJSON(w, http.StatusOK, out)
}

const (
	reportMaxSubject = 200
	reportMaxMessage = 10000
	reportLogLines   = 5000
)

func (s *Server) handleSupportReport(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Subject     string `json:"subject"`
		Message     string `json:"message"`
		IncludeLog  *bool  `json:"includeLog"`
		GrantAccess bool   `json:"grantAccess"`
	}
	if !decode(w, r, &body) {
		return
	}
	subject, message := strings.TrimSpace(body.Subject), strings.TrimSpace(body.Message)
	if subject == "" || len([]rune(subject)) > reportMaxSubject || strings.ContainsAny(subject, "\r\n") {
		writeError(w, http.StatusBadRequest, "invalid_subject", fmt.Sprintf("subject required (1–%d characters, one line)", reportMaxSubject))
		return
	}
	if message == "" || len([]rune(message)) > reportMaxMessage {
		writeError(w, http.StatusBadRequest, "invalid_message", fmt.Sprintf("message required (1–%d characters)", reportMaxMessage))
		return
	}
	includeLog := body.IncludeLog == nil || *body.IncludeLog
	ctx := bg(r)

	accessSummary := "Support access: NOT GRANTED."
	var fingerprint string
	if body.GrantAccess {
		added, k, err := s.support.Enable(ctx)
		switch {
		case err != nil:
			accessSummary = "Support access: REQUESTED but failed — " + err.Error()
		case added:
			fingerprint, accessSummary = k.Fingerprint, "Support access: GRANTED (fingerprint "+k.Fingerprint+")."
		default:
			fingerprint, accessSummary = k.Fingerprint, "Support access: ALREADY GRANTED (fingerprint "+k.Fingerprint+")."
		}
		s.dropFeatureCache()
	}

	var attachments []mail.Attachment
	logSummary := "Log attached: no."
	if includeLog {
		text, err := selfcheck.TailLines(s.cfg.LocalPath("log/yundera.log"), reportLogLines)
		switch {
		case err != nil:
			logSummary = "Log attached: no (error reading log — " + err.Error() + ")."
		case text == "":
			logSummary = "Log attached: no (log file empty or unreadable)."
		default:
			var gz bytes.Buffer
			zw := gzip.NewWriter(&gz)
			_, _ = zw.Write([]byte(text))
			_ = zw.Close()
			attachments = append(attachments, mail.Attachment{Filename: "yundera.log.gz", ContentType: "application/gzip", Content: gz.Bytes()})
			logSummary = fmt.Sprintf("Log attached: yundera.log.gz (last %d lines, %d bytes gzipped).", reportLogLines, gz.Len())
		}
	}

	id, _ := auth.FromContext(r.Context())
	reporter := id.User
	if id.Email != "" {
		reporter += " <" + id.Email + ">"
	}
	if reporter == "" {
		reporter = "unknown"
	}
	to := s.cfg.RecipientSupport()
	text := strings.Join([]string{
		"From: " + reporter,
		"PCS: " + or(s.domain(), "unknown-pcs") + " (UID " + or(s.cfg.UID, "unknown") + ")",
		accessSummary,
		logSummary,
		"",
		"— User message —",
		message,
	}, "\n")
	if err := s.mail.Send(mail.Message{To: to, Subject: "[PCS Support] " + subject, Text: text, Attachments: attachments}); err != nil {
		writeError(w, http.StatusBadGateway, "mail_failed", "failed to send the support email: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sent": true, "to": to, "grantedAccess": fingerprint != "", "fingerprint": fingerprint})
}

// ---- reboot ------------------------------------------------------------------------

func (s *Server) handleReboot(w http.ResponseWriter, r *http.Request) {
	if _, err := s.run.Run(bg(r), hostverb.Reboot()); err != nil {
		writeError(w, http.StatusInternalServerError, "host_action_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "rebooting"})
}
