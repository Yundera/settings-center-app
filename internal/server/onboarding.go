package server

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/yundera/settings-center-app/internal/backup"
	"github.com/yundera/settings-center-app/internal/hostverb"
	"github.com/yundera/settings-center-app/internal/onboarding"
)

// ---- onboarding state ----------------------------------------------------------
//
// The slides need two host answers: onboarding.sh status (claimed?) and
// backup.sh status. Maison asks GET /api/onboarding/check on every page load,
// so that route answers from RAM only: a snapshot refreshed every
// onbRefreshEvery in the background and right after anything that can change
// it (a claim, a feature switch, a backup action, a reset). The skip times are
// applied at read time, so a reminder comes back on the minute it is due.

const (
	onbRefreshEvery = time.Minute
	onbGatherLimit  = 2 * time.Minute
	// onbCheckWait bounds the one check that finds no snapshot yet (just after
	// a start): Maison gives up after ~1.5 s and serves its page anyway.
	onbCheckWait = 1200 * time.Millisecond
)

// onbFacts is one reading of the host.
type onbFacts struct {
	startedAt time.Time
	status    onboarding.Status
	backup    backup.Status
	// backupErr: backup.sh itself failed (not a state it reported). The UI
	// shows the slide as unavailable; the check does not redirect over it.
	backupErr string
}

// onbCache is the snapshot plus the single refresh loop feeding it.
type onbCache struct {
	mu      sync.Mutex
	facts   *onbFacts
	running bool
	again   bool
	done    chan struct{}
}

func (s *Server) gatherOnboarding(ctx context.Context) (*onbFacts, error) {
	f := &onbFacts{startedAt: time.Now()}
	var wg sync.WaitGroup
	var bErr error
	wg.Add(1)
	go func() {
		defer wg.Done()
		f.backup, bErr = s.backup.Status(ctx)
	}()
	st, err := s.onboard.Status(ctx)
	wg.Wait()
	if err != nil {
		return nil, err
	}
	f.status = st
	if bErr != nil {
		f.backup = backup.Status{State: backup.Unavailable}
		f.backupErr = backup.Describe(bErr)
	}
	return f, nil
}

// storeOnboarding keeps f unless a reading started later is already there.
func (s *Server) storeOnboarding(f *onbFacts) {
	s.onb.mu.Lock()
	defer s.onb.mu.Unlock()
	if s.onb.facts == nil || !f.startedAt.Before(s.onb.facts.startedAt) {
		s.onb.facts = f
	}
}

func (s *Server) cachedOnboarding() *onbFacts {
	s.onb.mu.Lock()
	defer s.onb.mu.Unlock()
	return s.onb.facts
}

// patchBackup records a backup state a backup action just answered.
func (s *Server) patchBackup(st backup.Status) {
	s.onb.mu.Lock()
	defer s.onb.mu.Unlock()
	if s.onb.facts != nil {
		f := *s.onb.facts
		f.backup, f.backupErr = st, ""
		s.onb.facts = &f
	}
}

// refreshOnboarding starts a background reading, or asks the running one to
// go round once more (its result may predate the change that triggered this
// call). The channel closes when the loop has stored its last reading.
func (s *Server) refreshOnboarding() <-chan struct{} {
	s.onb.mu.Lock()
	defer s.onb.mu.Unlock()
	if s.onb.running {
		s.onb.again = true
		return s.onb.done
	}
	s.onb.running = true
	done := make(chan struct{})
	s.onb.done = done
	go func() {
		for {
			ctx, cancel := context.WithTimeout(context.Background(), onbGatherLimit)
			f, err := s.gatherOnboarding(ctx)
			cancel()
			if err != nil {
				log.Printf("onboarding: refresh failed: %v", onboarding.Describe(err))
			} else {
				s.storeOnboarding(f)
			}
			s.onb.mu.Lock()
			if s.onb.again {
				s.onb.again = false
				s.onb.mu.Unlock()
				continue
			}
			s.onb.running = false
			close(done)
			s.onb.mu.Unlock()
			return
		}
	}()
	return done
}

func (s *Server) startOnboardingRefresh(stop <-chan struct{}) {
	s.refreshOnboarding()
	go func() {
		t := time.NewTicker(onbRefreshEvery)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				s.refreshOnboarding()
			}
		}
	}()
}

// slides applies the skip times to a reading. forCheck: a backup.sh failure
// counts as settled, so a broken host verb never sends Maison's visitors here.
func (s *Server) slides(f *onbFacts, forCheck bool) []onboarding.Slide {
	done := map[string]bool{
		onboarding.SlideAccount: f.status.Claimed,
		onboarding.SlideBackup:  f.backup.Settled() || (forCheck && f.backupErr != ""),
	}
	return onboarding.Slides(done, s.skips.All(), s.now())
}

type backupView struct {
	Enabled bool   `json:"enabled"`
	State   string `json:"state"`
	Engine  string `json:"engine,omitempty"`
}

func viewBackup(st backup.Status) backupView {
	return backupView{Enabled: st.Enabled, State: st.State, Engine: st.Engine}
}

// ---- routes ----------------------------------------------------------------------

func (s *Server) handleOnboardingStatus(w http.ResponseWriter, r *http.Request) {
	f, err := s.gatherOnboarding(bg(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "host_action_failed", onboarding.Describe(err))
		return
	}
	s.storeOnboarding(f)
	writeJSON(w, http.StatusOK, map[string]any{
		"claimed":   f.status.Claimed,
		"completed": f.status.Completed,
		"username":  f.status.Username,
		"slides":    s.slides(f, false),
		"backup":    viewBackup(f.backup),
		"backupJob": s.backupJobView(),
	})
}

// handleOnboardingCheck is Maison's question on every page load ("should this
// visitor go to the onboarding first?"), over pcs with the
// ONBOARDING_CHECK_TOKEN both containers receive. Contract: Maison
// docs/config.md (onboarding). It is not one of the gate's ALLOWED_PATHS: from
// the Internet it is behind the sign-in like every other /api route.
func (s *Server) handleOnboardingCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.cfg.OnboardingCheckToken == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Onboarding check is not configured on this server"})
		return
	}
	if !hasBearer(r, s.cfg.OnboardingCheckToken) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	f := s.cachedOnboarding()
	if f == nil {
		select {
		case <-s.refreshOnboarding():
		case <-time.After(onbCheckWait):
		}
		f = s.cachedOnboarding()
	}
	url, show := "", false
	if d := s.domain(); d != "" {
		url = "https://admin-" + d + "/"
		show = f != nil && onboarding.AnyPending(s.slides(f, true))
	}
	writeJSON(w, http.StatusOK, map[string]any{"show": show, "url": url})
}

func (s *Server) handleOnboardingSkip(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Slide string `json:"slide"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !onboarding.IsSlide(body.Slide) {
		writeError(w, http.StatusBadRequest, "unknown_slide", "body must include a known { slide }")
		return
	}
	if err := s.skips.Skip(body.Slide); err != nil {
		writeError(w, http.StatusInternalServerError, "skip_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"slide": body.Slide, "skippedAt": s.skips.All()[body.Slide]})
}

func (s *Server) handleBackup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Action   string `json:"action"`
		Password string `json:"password"`
		Confirm  bool   `json:"confirm"`
	}
	if !decode(w, r, &body) {
		return
	}
	if _, ok := hostverb.BackupVerbs[body.Action]; !ok {
		writeError(w, http.StatusBadRequest, "unknown_action", "body must include a known { action }")
		return
	}
	pw := ""
	switch body.Action {
	case "init", "recover":
		pw = body.Password
		if err := hostverb.ValidateBackupPassword(pw); err != nil {
			code := "invalid_backup_password"
			if err == hostverb.ErrBackupPasswordShort {
				code = "too_short"
			}
			writeError(w, http.StatusBadRequest, code, err.Error())
			return
		}
	case "reset":
		if !body.Confirm {
			writeError(w, http.StatusBadRequest, "confirm_required", `starting over deletes every backup of this server; send {"confirm": true}`)
			return
		}
	}
	if body.Action == "status" {
		st, err := s.backup.Status(bg(r))
		if err != nil {
			writeError(w, http.StatusInternalServerError, backup.Code(err), backup.Describe(err))
			return
		}
		s.patchBackup(st)
		writeJSON(w, http.StatusOK, viewBackup(st))
		return
	}
	job, ok := s.startBackupJob(body.Action, pw)
	if !ok {
		writeError(w, http.StatusConflict, "backup_busy", "another backup step is still running")
		return
	}
	writeJSON(w, http.StatusAccepted, job)
}

func (s *Server) handleBackupJob(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.backupJobView())
}

// ---- backup jobs -------------------------------------------------------------------
//
// Every backup action but status outlasts an HTTP request through the gate
// (init up to 4 min, recover 16, reset ~150 s; hostverb.BackupTimeouts), so
// POST /api/backup starts it here and answers 202; the UI polls
// GET /api/backup/job. One job at a time; the last result stays in RAM until
// the next job starts (a restart forgets it — the slide then simply reads the
// backup state again).

type backupJob struct {
	// Job: idle (none since start), running, done, failed.
	Job       string      `json:"job"`
	Action    string      `json:"action,omitempty"`
	StartedAt *time.Time  `json:"startedAt,omitempty"`
	EndedAt   *time.Time  `json:"endedAt,omitempty"`
	Backup    *backupView `json:"backup,omitempty"`
	Code      string      `json:"code,omitempty"`
	Error     string      `json:"error,omitempty"`
}

type backupJobs struct {
	mu   sync.Mutex
	cur  backupJob
	done chan struct{} // closed when the running job ends; tests wait on it
}

func (s *Server) backupJobView() backupJob {
	s.jobs.mu.Lock()
	defer s.jobs.mu.Unlock()
	if s.jobs.cur.Job == "" {
		return backupJob{Job: "idle"}
	}
	return s.jobs.cur
}

// startBackupJob runs action in the background; false when one already runs.
// The password lives only in the goroutine's closure and the runner's stdin.
func (s *Server) startBackupJob(action, password string) (backupJob, bool) {
	s.jobs.mu.Lock()
	defer s.jobs.mu.Unlock()
	if s.jobs.cur.Job == "running" {
		return s.jobs.cur, false
	}
	now := time.Now().UTC()
	s.jobs.cur = backupJob{Job: "running", Action: action, StartedAt: &now}
	done := make(chan struct{})
	s.jobs.done = done
	go func() {
		defer close(done)
		// No request context: the verb's own timeout bounds it.
		st, err := s.backup.Do(context.Background(), action, password)
		end := time.Now().UTC()
		s.jobs.mu.Lock()
		s.jobs.cur.EndedAt = &end
		if err != nil {
			s.jobs.cur.Job, s.jobs.cur.Code, s.jobs.cur.Error = "failed", backup.Code(err), backup.Describe(err)
			log.Printf("backup %s failed: %s", action, s.jobs.cur.Error)
		} else {
			v := viewBackup(st)
			s.jobs.cur.Job, s.jobs.cur.Backup = "done", &v
		}
		s.jobs.mu.Unlock()
		if err == nil {
			s.patchBackup(st)
		}
		s.refreshOnboarding()
	}()
	return s.jobs.cur, true
}
