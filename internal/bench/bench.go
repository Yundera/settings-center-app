// Package bench runs the disk and network benchmarks behind the public
// /api/bench/{disk,network}, which pcs-orchestrator's `pcs perf` reads.
//
// Lazy, like v1 (backend/server/Bench/BenchCache.ts): a GET answers the cached
// entry at once and, when nothing is in flight and the last attempt is older
// than Cooldown (or there was none), starts a run in the background. A caller
// polls until status is "ok". During a re-run the previous result keeps
// status "ok", so a reader never sees a good result disappear.
package bench

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/yundera/settings-center-app/internal/health"
	"github.com/yundera/settings-center-app/internal/hostrun"
	"github.com/yundera/settings-center-app/internal/hostverb"
)

const Cooldown = 10 * time.Minute

type Entry[T any] struct {
	Status       string  `json:"status"` // pending | ok | error
	Result       *T      `json:"result"`
	RanAt        *string `json:"ranAt"`
	PendingSince *string `json:"pendingSince"`
	Error        *string `json:"error"`
}

type Disk struct {
	WriteBps     float64 `json:"writeBps"`
	ReadBps      float64 `json:"readBps"`
	WriteSeconds float64 `json:"writeSeconds"`
	ReadSeconds  float64 `json:"readSeconds"`
	SizeBytes    int64   `json:"sizeBytes"`
	Target       string  `json:"target"`
	RanAt        string  `json:"ranAt"`
}

type Network struct {
	DownloadBps     float64 `json:"downloadBps"`
	UploadBps       float64 `json:"uploadBps"`
	DownloadSeconds float64 `json:"downloadSeconds"`
	UploadSeconds   float64 `json:"uploadSeconds"`
	SizeBytes       int64   `json:"sizeBytes"`
	Target          string  `json:"target"`
	RanAt           string  `json:"ranAt"`
}

type slot[T any] struct {
	mu          sync.Mutex
	entry       Entry[T]
	inFlight    bool
	lastAttempt time.Time
}

func (s *slot[T]) get(now func() time.Time, run func() (*T, string, error)) Entry[T] {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.entry.Status == "" {
		s.entry.Status = "pending"
	}
	if !s.inFlight && (s.lastAttempt.IsZero() || now().Sub(s.lastAttempt) >= Cooldown) {
		s.inFlight = true
		s.lastAttempt = now()
		ps := health.ISO(now())
		s.entry.PendingSince = &ps
		if s.entry.Result == nil {
			s.entry.Status = "pending"
		}
		go func() {
			res, ranAt, err := run()
			s.mu.Lock()
			defer s.mu.Unlock()
			if err != nil {
				msg := err.Error()
				s.entry.Error = &msg
				if s.entry.Result == nil {
					s.entry.Status = "error"
				}
			} else {
				s.entry.Result, s.entry.RanAt, s.entry.Status, s.entry.Error = res, &ranAt, "ok", nil
			}
			s.entry.PendingSince = nil
			s.inFlight = false
		}()
	}
	return s.entry
}

type Bench struct {
	run  hostrun.Runner
	now  func() time.Time
	disk slot[Disk]
	net  slot[Network]
}

func New(run hostrun.Runner) *Bench { return &Bench{run: run, now: time.Now} }

func (b *Bench) Disk() Entry[Disk] {
	return b.disk.get(b.now, func() (*Disk, string, error) {
		d, err := b.runDisk()
		if err != nil {
			return nil, "", err
		}
		return d, d.RanAt, nil
	})
}

func (b *Bench) Network() Entry[Network] {
	return b.net.get(b.now, func() (*Network, string, error) {
		n, err := b.runNetwork()
		if err != nil {
			return nil, "", err
		}
		return n, n.RanAt, nil
	})
}

func (b *Bench) exec(spec hostrun.Spec) (string, error) {
	res, err := b.run.Run(context.Background(), spec)
	if err != nil {
		return "", err
	}
	if err := res.Err(); err != nil {
		return "", err
	}
	return res.Stdout, nil
}

func (b *Bench) runDisk() (*Disk, error) {
	out, err := b.exec(hostverb.BenchDisk())
	if err != nil {
		return nil, err
	}
	return ParseDisk(out, b.now())
}

func (b *Bench) runNetwork() (*Network, error) {
	down, err := b.exec(hostverb.BenchNetDown())
	if err != nil {
		return nil, err
	}
	ds, dbps, err := parseCurl(down)
	if err != nil {
		return nil, err
	}
	up, err := b.exec(hostverb.BenchNetUp())
	if err != nil {
		return nil, err
	}
	us, ubps, err := parseCurl(up)
	if err != nil {
		return nil, err
	}
	return &Network{DownloadBps: dbps, UploadBps: ubps, DownloadSeconds: ds, UploadSeconds: us,
		SizeBytes: hostverb.BenchNetBytes, Target: hostverb.BenchNetTarget, RanAt: health.ISO(b.now())}, nil
}

var (
	ddBytesRe = regexp.MustCompile(`(\d+)\s+bytes\b`)
	ddSecsRe  = regexp.MustCompile(`copied,\s*([\d.eE+-]+)\s*s`)
	curlRe    = regexp.MustCompile(`^([\d.]+)\s+([\d.]+)$`)
)

func parseDD(block string) (bytes int64, secs float64, err error) {
	bm, sm := ddBytesRe.FindStringSubmatch(block), ddSecsRe.FindStringSubmatch(block)
	if bm == nil || sm == nil {
		return 0, 0, fmt.Errorf("unexpected dd output: %.200s", block)
	}
	bytes, _ = strconv.ParseInt(bm[1], 10, 64)
	secs, _ = strconv.ParseFloat(sm[1], 64)
	if secs <= 0 {
		return 0, 0, fmt.Errorf("bad dd parse: bytes=%d seconds=%v", bytes, secs)
	}
	return bytes, secs, nil
}

// ParseDisk reads the ===WRITE===/===READ===/===END=== blocks.
func ParseDisk(out string, at time.Time) (*Disk, error) {
	_, rest, ok1 := strings.Cut(out, "===WRITE===")
	w, rest, ok2 := strings.Cut(rest, "===READ===")
	r, _, ok3 := strings.Cut(rest, "===END===")
	if !ok1 || !ok2 || !ok3 {
		return nil, errors.New("disk bench output is incomplete")
	}
	wb, ws, err := parseDD(w)
	if err != nil {
		return nil, err
	}
	rb, rs, err := parseDD(r)
	if err != nil {
		return nil, err
	}
	return &Disk{WriteBps: float64(wb) / ws, ReadBps: float64(rb) / rs, WriteSeconds: ws, ReadSeconds: rs,
		SizeBytes: hostverb.BenchDiskMB * 1024 * 1024, Target: hostverb.BenchDiskTarget, RanAt: health.ISO(at)}, nil
}

func parseCurl(out string) (secs, bps float64, err error) {
	m := curlRe.FindStringSubmatch(strings.TrimSpace(out))
	if m == nil {
		return 0, 0, fmt.Errorf("unexpected curl output: %.120s", out)
	}
	secs, _ = strconv.ParseFloat(m[1], 64)
	bps, _ = strconv.ParseFloat(m[2], 64)
	return secs, bps, nil
}
