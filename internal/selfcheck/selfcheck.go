// Package selfcheck parses yundera.log into self-check runs and their scripts.
//
// Pure functions over the log text, shared by the public /api/health snapshot
// and the Health check page so the two cannot drift. Ported line for line from
// v1's backend/server/Health/SelfCheckLog.ts — /api/health's passed/total come
// from here and the orchestrator's `pcs list-health-check` reads them.
//
// What it keys on, all emitted by the template's library/log.sh:
//
//	[YYYY-MM-DD HH:MM:SS] [LEVEL] message
//	=== Self-check starting ===                               (INFO)
//	=== [ts] name.sh : starting ===                           (INFO)
//	=== [ts] name.sh : success (12s) ===                      (SUCCESS)
//	=== [ts] name.sh : failed (exit code: 1, 12s) ===         (ERROR)
//	=== Self-check completed successfully|with failures ===   (INFO)
//
// Result lines are matched on the level tag as well as the text, so a child
// script echoing "… : success" in its own [OUTPUT] lines cannot be miscounted.
//
// Timestamps stay as the host wrote them: bare YYYY-MM-DDTHH:MM:SS, no zone,
// because the log carries none. The UI must not reinterpret them.
package selfcheck

import (
	"bufio"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type ScriptStatus string

const (
	ScriptSuccess ScriptStatus = "success"
	ScriptFailed  ScriptStatus = "failed"
	ScriptRunning ScriptStatus = "running"
)

type Script struct {
	Name            string       `json:"name"`
	Status          ScriptStatus `json:"status"`
	DurationSec     *int         `json:"durationSec"`
	ExitCode        *int         `json:"exitCode"`
	StartedAt       *string      `json:"startedAt"`
	EndedAt         *string      `json:"endedAt"`
	Output          []string     `json:"output"`
	OutputTruncated bool         `json:"outputTruncated"`
}

type RunStatus string

const (
	RunSuccess  RunStatus = "success"
	RunFailures RunStatus = "failures"
	RunRunning  RunStatus = "running"
)

type Run struct {
	StartedAt   *string   `json:"startedAt"`
	EndedAt     *string   `json:"endedAt"`
	Status      RunStatus `json:"status"`
	Passed      int       `json:"passed"`
	Failed      int       `json:"failed"`
	Total       int       `json:"total"`
	DurationSec *int      `json:"durationSec"`
	Scripts     []*Script `json:"scripts"`
	// Truncated: the tail started mid-run, so the tally is partial.
	Truncated bool `json:"truncated"`
}

// MaxOutputLines caps the output kept per script (the last N).
const MaxOutputLines = 200

var (
	lineRe        = regexp.MustCompile(`^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]\s+\[([A-Z]+)\]\s?(.*)$`)
	runStartRe    = regexp.MustCompile(`^===\s+Self-check starting`)
	runEndRe      = regexp.MustCompile(`^===\s+Self-check completed (successfully|with failures)`)
	scriptStartRe = regexp.MustCompile(`^===\s+\[[^\]]+\]\s+(\S+)\s+:\s+starting\s+===`)
	scriptOKRe    = regexp.MustCompile(`^===\s+\[[^\]]+\]\s+(\S+)\s+:\s+success\s+\((\d+)s\)`)
	scriptFailRe  = regexp.MustCompile(`^===\s+\[[^\]]+\]\s+(\S+)\s+:\s+failed\s+\(exit code:\s*(\d+),\s*(\d+)s\)`)
)

type entry struct {
	date, time, level, message string
}

func (e entry) stamp() string { return e.date + "T" + e.time }

func parseLine(raw string) (entry, bool) {
	m := lineRe.FindStringSubmatch(strings.TrimRight(raw, "\r"))
	if m == nil {
		return entry{}, false
	}
	return entry{m[1], m[2], m[3], m[4]}, true
}

func strp(s string) *string { return &s }
func intp(i int) *int       { return &i }

func diffSeconds(from, to *string) *int {
	if from == nil || to == nil {
		return nil
	}
	const layout = "2006-01-02T15:04:05"
	a, err1 := time.Parse(layout, *from)
	b, err2 := time.Parse(layout, *to)
	if err1 != nil || err2 != nil {
		return nil
	}
	d := int(b.Sub(a).Round(time.Second) / time.Second)
	if d < 0 {
		return nil
	}
	return &d
}

func buildRun(start, end *entry, body []entry) *Run {
	scripts := []*Script{}
	var current *Script
	takeOpen := func(name string) *Script {
		for i := len(scripts) - 1; i >= 0; i-- {
			if scripts[i].Name == name && scripts[i].Status == ScriptRunning {
				return scripts[i]
			}
		}
		return nil
	}
	orNew := func(name string) *Script {
		if s := takeOpen(name); s != nil {
			return s
		}
		s := &Script{Name: name, Status: ScriptRunning, Output: []string{}}
		scripts = append(scripts, s)
		return s
	}

	for _, e := range body {
		switch e.level {
		case "INFO":
			if m := scriptStartRe.FindStringSubmatch(e.message); m != nil {
				current = &Script{Name: m[1], Status: ScriptRunning, StartedAt: strp(e.stamp()), Output: []string{}}
				scripts = append(scripts, current)
				continue
			}
		case "SUCCESS":
			if m := scriptOKRe.FindStringSubmatch(e.message); m != nil {
				s := orNew(m[1])
				s.Status = ScriptSuccess
				d, _ := strconv.Atoi(m[2])
				s.DurationSec = intp(d)
				s.EndedAt = strp(e.stamp())
				current = nil
				continue
			}
		case "ERROR":
			if m := scriptFailRe.FindStringSubmatch(e.message); m != nil {
				s := orNew(m[1])
				s.Status = ScriptFailed
				c, _ := strconv.Atoi(m[2])
				d, _ := strconv.Atoi(m[3])
				s.ExitCode, s.DurationSec = intp(c), intp(d)
				s.EndedAt = strp(e.stamp())
				current = nil
				continue
			}
		}
		if current != nil && (e.level == "OUTPUT" || e.level == "ERROR" || e.level == "WARN") {
			current.Output = append(current.Output, e.message)
			if len(current.Output) > MaxOutputLines {
				current.Output = current.Output[1:]
				current.OutputTruncated = true
			}
		}
	}

	r := &Run{Scripts: scripts, Truncated: start == nil}
	for _, s := range scripts {
		switch s.Status {
		case ScriptSuccess:
			r.Passed++
		case ScriptFailed:
			r.Failed++
		}
	}
	r.Total = r.Passed + r.Failed
	if start != nil {
		r.StartedAt = strp(start.stamp())
	}
	if end != nil {
		r.EndedAt = strp(end.stamp())
		if m := runEndRe.FindStringSubmatch(end.message); m != nil && m[1] == "successfully" {
			r.Status = RunSuccess
		} else {
			r.Status = RunFailures
		}
	} else {
		r.Status = RunRunning
	}
	r.DurationSec = diffSeconds(r.StartedAt, r.EndedAt)
	return r
}

// Parse returns every run in text, oldest first. Lines before the first run
// marker belong to a run whose start was cut off (truncated); lines after a
// completion and before the next start are outside every run (the reboot path
// logs restart-user-compose-stack.sh there) and are ignored.
func Parse(text string) []*Run {
	var runs []*Run
	var start *entry
	var body []entry
	inRun, sawAnything := false, false
	sc := bufio.NewScanner(strings.NewReader(text))
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		e, ok := parseLine(sc.Text())
		if !ok {
			continue
		}
		if e.level == "INFO" && runStartRe.MatchString(e.message) {
			if inRun {
				runs = append(runs, buildRun(start, nil, body))
			}
			ec := e
			start, body, inRun, sawAnything = &ec, nil, true, true
			continue
		}
		if e.level == "INFO" && runEndRe.MatchString(e.message) {
			s := start
			if !inRun {
				s = nil
			}
			ec := e
			runs = append(runs, buildRun(s, &ec, body))
			start, body, inRun, sawAnything = nil, nil, false, true
			continue
		}
		if inRun || !sawAnything {
			body = append(body, e)
		}
	}
	if inRun {
		runs = append(runs, buildRun(start, nil, body))
	}
	return runs
}

// Latest is the most recent run, finished or not.
func Latest(text string) *Run {
	runs := Parse(text)
	if len(runs) == 0 {
		return nil
	}
	return runs[len(runs)-1]
}

// LatestCompleted is the most recent run with a completion line.
func LatestCompleted(text string) *Run {
	runs := Parse(text)
	for i := len(runs) - 1; i >= 0; i-- {
		if runs[i].Status != RunRunning {
			return runs[i]
		}
	}
	return nil
}

// TailLines returns the last n lines of path as one string. logrotate uses
// copytruncate, so the file keeps its inode and only shrinks at rotation.
func TailLines(path string, n int) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	// Read at most ~1 KB per wanted line from the end; log lines are short.
	maxBytes := int64(n) * 1024
	if st, err := f.Stat(); err == nil && st.Size() > maxBytes {
		if _, err := f.Seek(st.Size()-maxBytes, io.SeekStart); err != nil {
			return "", err
		}
	}
	var lines []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		lines = append(lines, sc.Text())
		if len(lines) > n {
			lines = lines[1:]
		}
	}
	if err := sc.Err(); err != nil {
		return "", err
	}
	if len(lines) == 0 {
		return "", nil
	}
	return strings.Join(lines, "\n") + "\n", nil
}
