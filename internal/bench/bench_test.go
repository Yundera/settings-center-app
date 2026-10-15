package bench

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/yundera/settings-center-app/internal/contract"
	"github.com/yundera/settings-center-app/internal/hostrun"
)

const ddOut = `===WRITE===
256+0 records in
256+0 records out
268435456 bytes (268 MB, 256 MiB) copied, 0.713733 s, 376 MB/s
===READ===
256+0 records in
256+0 records out
268435456 bytes (268 MB, 256 MiB) copied, 0.570294 s, 471 MB/s
===END===
`

type fake struct {
	mu    sync.Mutex
	calls int
	fail  bool
	gate  chan struct{}
}

func (f *fake) Run(_ context.Context, s hostrun.Spec) (*hostrun.Result, error) {
	if f.gate != nil {
		<-f.gate
	}
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	if f.fail {
		return nil, errors.New("no socket")
	}
	switch {
	case s.Name == "bench-disk":
		return &hostrun.Result{Stdout: ddOut}, nil
	case strings.HasPrefix(s.Name, "bench-net"):
		return &hostrun.Result{Stdout: "0.849492 30858913"}, nil
	}
	return nil, errors.New("unexpected verb " + s.Name)
}

func waitStatus[T any](t *testing.T, get func() Entry[T], want string) Entry[T] {
	t.Helper()
	for i := 0; i < 200; i++ {
		e := get()
		if e.Status == want && e.PendingSince == nil {
			return e
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("status never became %s", want)
	return Entry[T]{}
}

func TestDiskLifecycleAndShape(t *testing.T) {
	f := &fake{gate: make(chan struct{})}
	b := New(f)
	first := b.Disk()
	if first.Status != "pending" || first.PendingSince == nil || first.Result != nil {
		t.Fatalf("first = %+v", first)
	}
	close(f.gate)
	e := waitStatus(t, b.Disk, "ok")
	if e.Result.WriteSeconds != 0.713733 || e.Result.SizeBytes != 268435456 || e.Result.Target != "/DATA/.bench.tmp" {
		t.Fatalf("result = %+v", e.Result)
	}
	got, _ := json.Marshal(e)
	want, _ := os.ReadFile("testdata/v1-disk.json")
	contract.SameShape(t, want, got)
	// Within the cooldown, no new run.
	calls := f.calls
	b.Disk()
	time.Sleep(20 * time.Millisecond)
	if f.calls != calls {
		t.Fatal("re-ran inside the cooldown")
	}
}

func TestNetworkShape(t *testing.T) {
	b := New(&fake{})
	b.Network()
	e := waitStatus(t, b.Network, "ok")
	got, _ := json.Marshal(e)
	want, _ := os.ReadFile("testdata/v1-network.json")
	contract.SameShape(t, want, got)
}

func TestFailureKeepsPreviousResult(t *testing.T) {
	f := &fake{}
	b := New(f)
	clock := time.Now()
	b.now = func() time.Time { return clock }
	b.Disk()
	waitStatus(t, b.Disk, "ok")
	f.fail = true
	clock = clock.Add(Cooldown + time.Second)
	e := waitStatus(t, b.Disk, "ok")
	if e.Result == nil || e.Error == nil {
		t.Fatalf("entry = %+v", e)
	}
	b2 := New(&fake{fail: true})
	b2.Disk()
	if e := waitStatus(t, b2.Disk, "error"); e.Result != nil || *e.Error != "no socket" {
		t.Fatalf("entry = %+v", e)
	}
}

func TestParseDiskRejectsGarbage(t *testing.T) {
	if _, err := ParseDisk("===WRITE===\nnope\n===READ===\n===END===", time.Now()); err == nil {
		t.Fatal("garbage accepted")
	}
	if _, err := ParseDisk("", time.Now()); err == nil {
		t.Fatal("empty accepted")
	}
}
