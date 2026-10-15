package server

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/yundera/settings-center-app/internal/mail"
)

// The public routes. None of them reads a file or runs anything on the request
// path except the identity push (which authenticates itself) and the feedback
// sink (which has its own bearer): everything else serves RAM.

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.health.Snapshot())
}

func (s *Server) handlePerf(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.metrics.Perf())
}

func (s *Server) handleBenchDisk(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.bench.Disk())
}

func (s *Server) handleBenchNetwork(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.bench.Network())
}

// ---- Maison's feedback sink --------------------------------------------------
//
// Maison posts its "Send feedback" form here over pcs (FEEDBACK_URL =
// http://admin-app/api/feedback/ingest, written by template-root's mesh.sh),
// with the FEEDBACK_TOKEN both containers receive. Contract:
// maison docs/feedback.md. No FEEDBACK_TOKEN ⇒ 404, the "not configured" answer
// Maison hides its button on.

const feedbackMaxLength = 5000

var bearerRe = regexp.MustCompile(`(?i)^Bearer\s+(.+)$`)

func hasBearer(r *http.Request, expected string) bool {
	if expected == "" {
		return false
	}
	m := bearerRe.FindStringSubmatch(r.Header.Get("Authorization"))
	if m == nil {
		return false
	}
	a, b := sha256.Sum256([]byte(strings.TrimSpace(m[1]))), sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

func clip(v any, max int) string {
	s, _ := v.(string)
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > max {
		s = string([]rune(s)[:max])
	}
	return s
}

func (s *Server) handleFeedback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.cfg.FeedbackToken == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Feedback is not configured on this server"})
		return
	}
	if !hasBearer(r, s.cfg.FeedbackToken) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		out := map[string]any{
			"operator":    "Yundera",
			"privacyNote": "Read by the Yundera team. It includes this server's address so they can follow up.",
			"maxLength":   feedbackMaxLength,
		}
		if s.cfg.Domain != "" {
			out["supportUrl"] = "https://admin-" + s.cfg.Domain + "/support"
		}
		writeJSON(w, http.StatusOK, out)
		return
	case http.MethodPost:
	default:
		w.Header().Set("Allow", "GET, POST")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

	var body map[string]any
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&body); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Body exceeded 32kb limit"})
			return
		}
		body = map[string]any{}
	}
	message, _ := body["message"].(string)
	message = strings.TrimSpace(message)
	if message == "" || utf8.RuneCountInString(message) > feedbackMaxLength {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Message required (1–5000 characters)"})
		return
	}
	category, _ := body["category"].(string)
	switch category {
	case "idea", "bug", "other":
	default:
		category = "other"
	}
	ctx, _ := body["context"].(map[string]any)
	source := clip(ctx["source"], 40)
	if source == "" {
		source = "unknown"
	}
	version := clip(ctx["version"], 40)
	if version == "" {
		version = "unknown"
	}
	page, appID, reporter := clip(ctx["page"], 200), clip(ctx["appId"], 100), clip(body["reporter"], 200)
	if reporter == "" {
		reporter = "not identified"
	}

	first, _, _ := strings.Cut(message, "\n")
	if utf8.RuneCountInString(first) > 60 {
		first = string([]rune(first)[:60]) + "…"
	}
	lines := []string{
		"PCS: " + or(s.cfg.Domain, "unknown-pcs") + " (UID " + or(s.cfg.UID, "unknown") + ")",
		"From: " + reporter,
		"Source: " + source + " " + version,
		"Category: " + category,
	}
	if page != "" {
		lines = append(lines, "Page: "+page)
	}
	if appID != "" {
		lines = append(lines, "App: "+appID)
	}
	lines = append(lines, "", "— Feedback —", message)

	err := s.mail.Send(mail.Message{
		To:      s.cfg.RecipientFeedback(),
		Subject: "[PCS Feedback] " + category + ": " + first,
		Text:    strings.Join(lines, "\n"),
	})
	if err != nil {
		log.Printf("feedback: mail failed: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Could not deliver your feedback right now — please try again later"})
		return
	}
	log.Printf("feedback: %s from %s %s mailed to Yundera", category, source, version)
	writeJSON(w, http.StatusAccepted, map[string]bool{"sent": true})
}

func or(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
