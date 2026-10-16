package onboarding

import (
	"path/filepath"
	"testing"
	"time"
)

func TestSlides(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
	got := Slides(map[string]bool{SlideAccount: true}, map[string]time.Time{SlideAccount: now.Add(-time.Hour), SlideBackup: now.Add(-time.Hour)}, now)
	if got[0].State != StateDone || got[1].State != StateSkipped || AnyPending(got) {
		t.Fatalf("done + fresh skip = %+v", got)
	}
	got = Slides(map[string]bool{}, map[string]time.Time{SlideBackup: now.Add(-ReminderAfter)}, now)
	if got[0].State != StatePending || got[1].State != StatePending || got[1].SkippedAt == nil || !AnyPending(got) {
		t.Fatalf("never skipped + old skip = %+v", got)
	}
}

func TestSkipsStore(t *testing.T) {
	now := time.Date(2026, 10, 16, 12, 0, 0, 500, time.UTC)
	path := filepath.Join(t.TempDir(), "sub", "onboarding-skips.json")
	k := &Skips{Path: path, Now: func() time.Time { return now }}
	if len(k.All()) != 0 {
		t.Fatal("empty store not empty")
	}
	if err := k.Skip("nope"); err == nil {
		t.Fatal("unknown slide skipped")
	}
	if err := k.Skip(SlideBackup); err != nil {
		t.Fatal(err)
	}
	again := &Skips{Path: path, Now: time.Now}
	if at := again.All()[SlideBackup]; !at.Equal(now.Truncate(time.Second)) {
		t.Fatalf("reloaded = %v", again.All())
	}
}
