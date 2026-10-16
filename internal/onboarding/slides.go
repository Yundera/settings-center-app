package onboarding

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// The onboarding is one slide per topic. A slide is done when the box no
// longer needs anything from the owner on that topic; the owner may skip one
// ("Skip for now"), and a skipped slide comes back ReminderAfter later. While
// any slide is pending, Maison sends the owner here (GET /api/onboarding/check).

const (
	SlideAccount = "account" // done = the box is claimed (a local owner account exists)
	SlideBackup  = "backup"  // done = backups ready, or switched off on purpose
)

// SlideIDs is the display order.
var SlideIDs = []string{SlideAccount, SlideBackup}

// ReminderAfter is how long a skipped slide stays quiet.
const ReminderAfter = 72 * time.Hour

const (
	StatePending = "pending"
	StateDone    = "done"
	StateSkipped = "skipped"
)

type Slide struct {
	ID        string     `json:"id"`
	State     string     `json:"state"`
	SkippedAt *time.Time `json:"skippedAt,omitempty"`
}

// Slides computes each slide's state. done maps a slide id to whether the box
// has settled it; skips are the owner's "Skip for now" times.
func Slides(done map[string]bool, skips map[string]time.Time, now time.Time) []Slide {
	out := make([]Slide, 0, len(SlideIDs))
	for _, id := range SlideIDs {
		sl := Slide{ID: id, State: StatePending}
		if at, ok := skips[id]; ok {
			at := at
			sl.SkippedAt = &at
		}
		switch {
		case done[id]:
			sl.State = StateDone
		case sl.SkippedAt != nil && now.Sub(*sl.SkippedAt) < ReminderAfter:
			sl.State = StateSkipped
		}
		out = append(out, sl)
	}
	return out
}

// AnyPending reports whether a slide wants the owner now.
func AnyPending(slides []Slide) bool {
	for _, s := range slides {
		if s.State == StatePending {
			return true
		}
	}
	return false
}

// IsSlide reports a known slide id.
func IsSlide(id string) bool {
	for _, s := range SlideIDs {
		if s == id {
			return true
		}
	}
	return false
}

// Skips is the "Skip for now" store: ${DataDir}/onboarding-skips.json,
// {"<slide>": "<RFC3339>"}. It is read once and kept in memory, so the check
// Maison makes on every page load never touches the disk.
type Skips struct {
	Path string
	Now  func() time.Time

	mu     sync.Mutex
	loaded bool
	m      map[string]time.Time
}

func (k *Skips) load() {
	if k.loaded {
		return
	}
	k.loaded = true
	k.m = map[string]time.Time{}
	raw, err := os.ReadFile(k.Path)
	if err != nil {
		return
	}
	var v map[string]time.Time
	if json.Unmarshal(raw, &v) == nil {
		for id, at := range v {
			if IsSlide(id) {
				k.m[id] = at
			}
		}
	}
}

// All is a copy of the skip times.
func (k *Skips) All() map[string]time.Time {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.load()
	out := make(map[string]time.Time, len(k.m))
	for id, at := range k.m {
		out[id] = at
	}
	return out
}

// Skip records slide as skipped now.
func (k *Skips) Skip(slide string) error {
	if !IsSlide(slide) {
		return fmt.Errorf("unknown slide %q", slide)
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	k.load()
	next := make(map[string]time.Time, len(k.m)+1)
	for id, at := range k.m {
		next[id] = at
	}
	next[slide] = k.Now().UTC().Truncate(time.Second)
	if err := writeAtomic(k.Path, next); err != nil {
		return err
	}
	k.m = next
	return nil
}

func writeAtomic(path string, v any) error {
	if path == "" {
		return errors.New("no skip store path")
	}
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
