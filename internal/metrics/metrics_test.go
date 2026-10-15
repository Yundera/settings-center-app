package metrics

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/yundera/settings-center-app/internal/contract"
	"github.com/yundera/settings-center-app/internal/hostrun"
)

type fakeRun struct {
	out string
	err error
}

func (f *fakeRun) Run(context.Context, hostrun.Spec) (*hostrun.Result, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &hostrun.Result{Stdout: f.out}, nil
}

func sample(t *testing.T) string {
	raw, err := os.ReadFile("testdata/sample1.txt")
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestParseRealSample(t *testing.T) {
	s := Parse(sample(t), time.Now())
	if s.Nproc != 3 || s.Mem.TotalBytes == 0 || s.Uptime == 0 || s.Load1 == 0 && s.Load5 == 0 {
		t.Fatalf("sample = %+v", s)
	}
	if len(s.Filesystems) != 3 || s.Filesystems[0].Target != "/" || s.Root().Target != "/" {
		t.Fatalf("filesystems = %+v", s.Filesystems)
	}
	for _, d := range s.disks {
		if d.device[:3] == "loo" || d.device[:3] == "dm-" {
			t.Fatalf("disk %s not skipped", d.device)
		}
	}
	for _, n := range s.nets {
		if n.iface == "lo" {
			t.Fatal("lo not skipped")
		}
	}
	if len(s.nets) == 0 || len(s.disks) == 0 {
		t.Fatalf("nets=%d disks=%d", len(s.nets), len(s.disks))
	}
}

func stripRates(t *testing.T, b []byte) []byte {
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"diskReadBps", "diskWriteBps", "netRxBps", "netTxBps"} {
		if _, ok := m[k].(map[string]any); !ok {
			t.Fatalf("%s is not an object: %v", k, m[k])
		}
		m[k] = map[string]any{}
	}
	out, _ := json.Marshal(m)
	return out
}

func TestPerfMatchesV1Shape(t *testing.T) {
	f := &fakeRun{out: sample(t)}
	s := New(f)
	s.Refresh(context.Background())
	s.mu.Lock()
	s.cur.SampledAt = s.cur.SampledAt.Add(-5 * time.Minute) // a second sample 5 min later
	s.mu.Unlock()
	s.Refresh(context.Background())
	got, _ := json.Marshal(s.Perf())
	want, _ := os.ReadFile("testdata/v1-perf.json")
	contract.SameShape(t, stripRates(t, want), stripRates(t, got))
	p := s.Perf()
	if p.CPU.BusyFrac != nil {
		t.Fatalf("identical jiffies should give no busy fraction, got %v", *p.CPU.BusyFrac)
	}
	if len(p.NetRxBps) == 0 || p.NetRxBps["eth0"] != 0 {
		t.Fatalf("rates = %v", p.NetRxBps)
	}
}

func TestBeforeFirstSample(t *testing.T) {
	s := New(&fakeRun{err: errors.New("no socket")})
	s.Refresh(context.Background())
	p := s.Perf()
	b, _ := json.Marshal(p)
	if p.Mem != nil || p.SampledAt != nil || p.LastError == nil || *p.LastError != "no socket" {
		t.Fatalf("perf = %s", b)
	}
	if string(mustJSON(p.Filesystems)) != "[]" || string(mustJSON(p.DiskReadBps)) != "{}" {
		t.Fatalf("empty collections must serialise as [] / {}: %s", b)
	}
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func TestRates(t *testing.T) {
	t0 := time.Unix(1000, 0)
	a := &Sample{SampledAt: t0, cpu: cpuStat{user: 100, idle: 900},
		disks: []diskStat{{"sda", 0, 0}}, nets: []netStat{{"eth0", 0, 0}}}
	b := &Sample{SampledAt: t0.Add(10 * time.Second), cpu: cpuStat{user: 150, idle: 950},
		disks: []diskStat{{"sda", 20, 40}}, nets: []netStat{{"eth0", 1000, 500}}}
	r := computeRates(a, b)
	if *r.cpuBusy != 0.5 || r.diskR["sda"] != 1024 || r.diskW["sda"] != 2048 || r.netR["eth0"] != 100 || r.netT["eth0"] != 50 {
		t.Fatalf("rates = %+v %v %v", *r.cpuBusy, r.diskR, r.netR)
	}
}
