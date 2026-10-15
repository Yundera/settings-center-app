package selfcheck

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testdata/yundera.log is holyhorse's real log of 2026-10-15, whose
// /api/health (v1) answered passed 25 / total 25, lastRunAt 03:02:01.
func TestRealLogMatchesV1(t *testing.T) {
	raw, err := os.ReadFile("testdata/yundera.log")
	if err != nil {
		t.Fatal(err)
	}
	r := LatestCompleted(string(raw))
	if r == nil {
		t.Fatal("no completed run")
	}
	if r.Status != RunSuccess || r.Passed != 25 || r.Total != 25 || r.Truncated {
		t.Fatalf("run = %+v", r)
	}
	if *r.EndedAt != "2026-10-15T03:02:01" || *r.StartedAt != "2026-10-15T03:00:04" || *r.DurationSec != 117 {
		t.Fatalf("times = %s %s %d", *r.StartedAt, *r.EndedAt, *r.DurationSec)
	}
}

const failing = `[2026-01-01 03:00:00] [INFO] === Self-check starting ===
[2026-01-01 03:00:01] [INFO] === [2026-01-01 03:00:01] a.sh : starting ===
[2026-01-01 03:00:01] [OUTPUT] x.sh : success (1s)
[2026-01-01 03:00:02] [SUCCESS] === [2026-01-01 03:00:02] a.sh : success (1s) ===
[2026-01-01 03:00:02] [INFO] === [2026-01-01 03:00:02] b.sh : starting ===
[2026-01-01 03:00:03] [OUTPUT] doing b
[2026-01-01 03:00:04] [ERROR] boom
[2026-01-01 03:00:05] [ERROR] === [2026-01-01 03:00:05] b.sh : failed (exit code: 3, 3s) ===
[2026-01-01 03:00:06] [INFO] === Self-check completed with failures ===
[2026-01-01 03:00:07] [SUCCESS] === [2026-01-01 03:00:07] restart-user-compose-stack.sh : success (1s) ===
`

func TestFailingRun(t *testing.T) {
	r := LatestCompleted(failing)
	if r.Status != RunFailures || r.Passed != 1 || r.Failed != 1 || r.Total != 2 {
		t.Fatalf("run = %+v", r)
	}
	b := r.Scripts[1]
	if b.Name != "b.sh" || b.Status != ScriptFailed || *b.ExitCode != 3 || *b.DurationSec != 3 {
		t.Fatalf("b = %+v", b)
	}
	if strings.Join(b.Output, "|") != "doing b|boom" {
		t.Fatalf("output = %q", b.Output)
	}
	// A child's OUTPUT line that looks like a result is not a result.
	if r.Scripts[0].Status != ScriptSuccess || len(r.Scripts) != 2 {
		t.Fatalf("scripts = %+v", r.Scripts)
	}
}

func TestRunningAndTruncated(t *testing.T) {
	running := failing + "[2026-01-02 03:00:00] [INFO] === Self-check starting ===\n" +
		"[2026-01-02 03:00:01] [INFO] === [2026-01-02 03:00:01] a.sh : starting ===\n"
	if l := Latest(running); l.Status != RunRunning || len(l.Scripts) != 1 || l.Scripts[0].Status != ScriptRunning {
		t.Fatalf("latest = %+v", l)
	}
	if c := LatestCompleted(running); c.Status != RunFailures {
		t.Fatalf("completed = %+v", c)
	}
	// A tail that starts mid-run.
	cut := strings.SplitN(failing, "\n", 4)[3]
	r := LatestCompleted(cut)
	if !r.Truncated || r.StartedAt != nil || r.DurationSec != nil {
		t.Fatalf("truncated = %+v", r)
	}
	if LatestCompleted("") != nil || Latest("garbage\n") != nil {
		t.Fatal("empty input produced a run")
	}
}

func TestOutputCapped(t *testing.T) {
	var b strings.Builder
	b.WriteString("[2026-01-01 03:00:00] [INFO] === Self-check starting ===\n")
	b.WriteString("[2026-01-01 03:00:00] [INFO] === [2026-01-01 03:00:00] a.sh : starting ===\n")
	for i := 0; i < MaxOutputLines+5; i++ {
		b.WriteString("[2026-01-01 03:00:00] [OUTPUT] line\n")
	}
	s := Latest(b.String()).Scripts[0]
	if len(s.Output) != MaxOutputLines || !s.OutputTruncated {
		t.Fatalf("len=%d truncated=%v", len(s.Output), s.OutputTruncated)
	}
}

func TestTailLines(t *testing.T) {
	p := filepath.Join(t.TempDir(), "l")
	_ = os.WriteFile(p, []byte("1\n2\n3\n4\n"), 0o600)
	got, err := TailLines(p, 2)
	if err != nil || got != "3\n4\n" {
		t.Fatalf("got %q %v", got, err)
	}
	if _, err := TailLines(filepath.Join(t.TempDir(), "nope"), 2); err == nil {
		t.Fatal("missing file did not error")
	}
}
