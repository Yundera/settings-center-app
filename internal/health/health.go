// Package health keeps the snapshot /api/health serves.
//
// The route is public (the gate's ALLOWED_PATHS) and polled by the Yundera
// control plane: pcs-orchestrator's parseAdminHealth (waitForDomainReady,
// `pcs list-health-check`) requires `version` and a `selfCheck` object, treats
// selfCheck.ok === false as fatal and null as "no run yet", and reads
// passed/total. The request path only reads RAM, so there is nothing to
// amplify by hitting it in a loop; a background refresher fills it every 5
// minutes. Shape kept byte-compatible with v1 (backend/server/Health/Health.ts).
package health

import (
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/yundera/settings-center-app/internal/selfcheck"
)

// LogTailLines is how much of yundera.log one refresh reads.
const LogTailLines = 2000

// Interval is the refresh period.
const Interval = 5 * time.Minute

type SelfCheck struct {
	OK        *bool   `json:"ok"`
	LastRunAt *string `json:"lastRunAt"`
	Passed    *int    `json:"passed"`
	Total     *int    `json:"total"`
}

type ProcessPressure struct {
	PidsCurrent *int `json:"pidsCurrent"`
	PidsMax     *int `json:"pidsMax"`
	Zombies     *int `json:"zombies"`
	Warning     bool `json:"warning"`
}

type Snapshot struct {
	Version         string          `json:"version"`
	SelfCheck       SelfCheck       `json:"selfCheck"`
	ProcessPressure ProcessPressure `json:"processPressure"`
	LastRefreshedAt *string         `json:"lastRefreshedAt"`
	LastError       *string         `json:"lastError"`
}

// ISO renders t like JavaScript's toISOString, which v1 emitted.
func ISO(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

type Keeper struct {
	version string
	logFile string
	// procRoot / cgroupRoot are overridable for tests.
	procRoot, cgroupRoot string

	mu   sync.RWMutex
	snap Snapshot
}

func New(version, logFile string) *Keeper {
	return &Keeper{version: version, logFile: logFile, procRoot: "/proc", cgroupRoot: "/sys/fs/cgroup",
		snap: Snapshot{Version: version}}
}

func (k *Keeper) Snapshot() Snapshot {
	k.mu.RLock()
	defer k.mu.RUnlock()
	return k.snap
}

// Start refreshes now, then every Interval, until stop is closed.
func (k *Keeper) Start(stop <-chan struct{}) {
	k.Refresh()
	go func() {
		t := time.NewTicker(Interval)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				k.Refresh()
			case <-stop:
				return
			}
		}
	}()
}

// Refresh re-reads the log. Process pressure is sampled first and stored on
// both paths: the failure it exists to explain is one where everything else
// fails because the container is out of PIDs.
func (k *Keeper) Refresh() {
	pp := ReadPressure(k.procRoot, k.cgroupRoot)
	if pp.Warning {
		log.Printf("health: container process pressure is abnormal — %s/%s PIDs, %s zombie(s)",
			itoa(pp.PidsCurrent), itoaOr(pp.PidsMax, "unlimited"), itoa(pp.Zombies))
	}
	text, err := selfcheck.TailLines(k.logFile, LogTailLines)
	k.mu.Lock()
	defer k.mu.Unlock()
	k.snap.ProcessPressure = pp
	if err != nil {
		msg := err.Error()
		log.Printf("health: cannot read the self-check log: %s", msg)
		k.snap.LastError = &msg
		return
	}
	k.snap.SelfCheck = summarize(selfcheck.LatestCompleted(text))
	now := ISO(time.Now())
	k.snap.LastRefreshedAt = &now
	k.snap.LastError = nil
}

func summarize(r *selfcheck.Run) SelfCheck {
	if r == nil {
		return SelfCheck{}
	}
	ok := r.Status == selfcheck.RunSuccess
	out := SelfCheck{OK: &ok, LastRunAt: r.EndedAt}
	if !r.Truncated && r.Total > 0 {
		p, t := r.Passed, r.Total
		out.Passed, out.Total = &p, &t
	}
	return out
}

// Thresholds past which processPressure.warning is set: something is leaking
// processes, and when the pid cgroup fills every fork() fails with EAGAIN.
const (
	pidsWarnRatio   = 0.25
	zombieWarnCount = 100
)

// ReadPressure samples PID headroom inside this container. Any counter that
// cannot be read is nil rather than 0; pids.max "max" (unlimited) is nil.
func ReadPressure(procRoot, cgroupRoot string) ProcessPressure {
	var pp ProcessPressure
	pp.PidsCurrent = readInt(cgroupRoot+"/pids.current", cgroupRoot+"/pids/pids.current")
	pp.PidsMax = readInt(cgroupRoot+"/pids.max", cgroupRoot+"/pids/pids.max")
	pp.Zombies = countZombies(procRoot)
	if pp.PidsCurrent != nil && pp.PidsMax != nil && float64(*pp.PidsCurrent) >= float64(*pp.PidsMax)*pidsWarnRatio {
		pp.Warning = true
	}
	if pp.Zombies != nil && *pp.Zombies >= zombieWarnCount {
		pp.Warning = true
	}
	return pp
}

func readInt(paths ...string) *int {
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		v, err := strconv.Atoi(strings.TrimSpace(string(raw)))
		if err != nil {
			return nil // "max", or garbage
		}
		return &v
	}
	return nil
}

func countZombies(procRoot string) *int {
	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return nil
	}
	n := 0
	for _, e := range entries {
		if _, err := strconv.Atoi(e.Name()); err != nil {
			continue
		}
		raw, err := os.ReadFile(procRoot + "/" + e.Name() + "/stat")
		if err != nil {
			continue
		}
		s := string(raw)
		i := strings.LastIndexByte(s, ')')
		if i < 0 {
			continue
		}
		if rest := strings.TrimSpace(s[i+1:]); strings.HasPrefix(rest, "Z") {
			n++
		}
	}
	return &n
}

func itoa(p *int) string { return itoaOr(p, "?") }

func itoaOr(p *int, def string) string {
	if p == nil {
		return def
	}
	return strconv.Itoa(*p)
}
