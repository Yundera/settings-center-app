package health

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/yundera/settings-center-app/internal/contract"
)

func fakeProc(t *testing.T) (proc, cg string) {
	t.Helper()
	proc, cg = t.TempDir(), t.TempDir()
	for pid, stat := range map[string]string{
		"1":  "1 (tini) S 0 1",
		"7":  "7 (we(ird) name) Z 1 7",
		"12": "12 (sh) R 1 12",
	} {
		_ = os.MkdirAll(filepath.Join(proc, pid), 0o755)
		_ = os.WriteFile(filepath.Join(proc, pid, "stat"), []byte(stat), 0o644)
	}
	_ = os.MkdirAll(filepath.Join(proc, "self"), 0o755)
	_ = os.WriteFile(filepath.Join(cg, "pids.current"), []byte("53\n"), 0o644)
	_ = os.WriteFile(filepath.Join(cg, "pids.max"), []byte("9484\n"), 0o644)
	return proc, cg
}

func TestSnapshotMatchesV1Shape(t *testing.T) {
	proc, cg := fakeProc(t)
	k := New("2.0.0", "../selfcheck/testdata/yundera.log")
	k.procRoot, k.cgroupRoot = proc, cg
	k.Refresh()
	got, _ := json.Marshal(k.Snapshot())
	want, err := os.ReadFile("testdata/v1-health.json")
	if err != nil {
		t.Fatal(err)
	}
	contract.SameShape(t, want, got)

	s := k.Snapshot()
	if s.SelfCheck.OK == nil || !*s.SelfCheck.OK || *s.SelfCheck.Passed != 25 || *s.SelfCheck.Total != 25 || *s.SelfCheck.LastRunAt != "2026-10-15T03:02:01" {
		t.Fatalf("selfCheck = %+v", s.SelfCheck)
	}
	if *s.ProcessPressure.PidsCurrent != 53 || *s.ProcessPressure.PidsMax != 9484 || *s.ProcessPressure.Zombies != 1 || s.ProcessPressure.Warning {
		t.Fatalf("pressure = %+v", s.ProcessPressure)
	}
}

func TestNoRunYetIsNull(t *testing.T) {
	p := filepath.Join(t.TempDir(), "yundera.log")
	_ = os.WriteFile(p, []byte("[2026-01-01 00:00:00] [INFO] hello\n"), 0o644)
	k := New("2.0.0", p)
	k.Refresh()
	b, _ := json.Marshal(k.Snapshot().SelfCheck)
	if string(b) != `{"ok":null,"lastRunAt":null,"passed":null,"total":null}` {
		t.Fatalf("selfCheck = %s", b)
	}
}

func TestUnreadableLogKeepsPreviousVerdict(t *testing.T) {
	k := New("2.0.0", "../selfcheck/testdata/yundera.log")
	k.Refresh()
	k.logFile = "/nonexistent"
	k.Refresh()
	s := k.Snapshot()
	if s.LastError == nil || s.SelfCheck.OK == nil || !*s.SelfCheck.OK {
		t.Fatalf("snapshot = %+v", s)
	}
}

func TestPressureWarnings(t *testing.T) {
	proc, cg := fakeProc(t)
	_ = os.WriteFile(filepath.Join(cg, "pids.current"), []byte("3000\n"), 0o644)
	if !ReadPressure(proc, cg).Warning {
		t.Fatal("25% of pids.max should warn")
	}
	_ = os.WriteFile(filepath.Join(cg, "pids.max"), []byte("max\n"), 0o644)
	pp := ReadPressure(proc, cg)
	if pp.PidsMax != nil || pp.Warning {
		t.Fatalf("unlimited = %+v", pp)
	}
	pp = ReadPressure("/nonexistent", "/nonexistent")
	if pp.PidsCurrent != nil || pp.Zombies != nil || pp.Warning {
		t.Fatalf("unknown = %+v", pp)
	}
}
