// Package metrics samples the host every 5 minutes for the public /api/perf,
// which pcs-orchestrator's `pcs perf` / `list-perf` read (cpu, mem,
// filesystems, lastError at least). The request path only reads RAM.
//
// Ported from v1's backend/server/Metrics/Metrics.ts: one host verb prints
// ===SECTION=== blocks (hostverb.MetricsScript), parsed here. Rates need two
// samples, so they are empty until the second cycle. The Overview's Storage
// tile reads the same sample.
package metrics

import (
	"context"
	"log"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/yundera/settings-center-app/internal/health"
	"github.com/yundera/settings-center-app/internal/hostrun"
	"github.com/yundera/settings-center-app/internal/hostverb"
)

const Interval = 5 * time.Minute

const sectorBytes = 512

type Mem struct {
	TotalBytes     int64 `json:"totalBytes"`
	FreeBytes      int64 `json:"freeBytes"`
	AvailableBytes int64 `json:"availableBytes"`
	BuffersBytes   int64 `json:"buffersBytes"`
	CachedBytes    int64 `json:"cachedBytes"`
	SwapTotalBytes int64 `json:"swapTotalBytes"`
	SwapFreeBytes  int64 `json:"swapFreeBytes"`
}

type Filesystem struct {
	Source     string `json:"-"`
	Target     string `json:"target"`
	SizeBytes  int64  `json:"sizeBytes"`
	UsedBytes  int64  `json:"usedBytes"`
	AvailBytes int64  `json:"availBytes"`
}

type cpuStat struct{ user, nice, system, idle, iowait, irq, softirq, steal int64 }

func (c cpuStat) total() int64 {
	return c.user + c.nice + c.system + c.idle + c.iowait + c.irq + c.softirq + c.steal
}

type diskStat struct {
	device                    string
	sectorsRead, sectorsWritt int64
}

type netStat struct {
	iface  string
	rx, tx int64
}

// Sample is one parsed collection.
type Sample struct {
	Uptime               float64
	SampledAt            time.Time
	Load1, Load5, Load15 float64
	Nproc                int
	Mem                  Mem
	cpu                  cpuStat
	disks                []diskStat
	nets                 []netStat
	Filesystems          []Filesystem
}

type CPU struct {
	BusyFrac *float64 `json:"busyFrac"`
	Load1    float64  `json:"load1"`
	Load5    float64  `json:"load5"`
	Load15   float64  `json:"load15"`
	Nproc    int      `json:"nproc"`
}

// Perf is the /api/perf body, byte-compatible with v1's PublicPerfResponse.
type Perf struct {
	SampledAt       *int64             `json:"sampledAt"`
	LastRefreshedAt *string            `json:"lastRefreshedAt"`
	Uptime          *float64           `json:"uptime"`
	CPU             CPU                `json:"cpu"`
	Mem             *Mem               `json:"mem"`
	Filesystems     []Filesystem       `json:"filesystems"`
	DiskReadBps     map[string]float64 `json:"diskReadBps"`
	DiskWriteBps    map[string]float64 `json:"diskWriteBps"`
	NetRxBps        map[string]float64 `json:"netRxBps"`
	NetTxBps        map[string]float64 `json:"netTxBps"`
	LastError       *string            `json:"lastError"`
}

type rates struct {
	cpuBusy                  *float64
	diskR, diskW, netR, netT map[string]float64
}

func emptyRates() rates {
	return rates{diskR: map[string]float64{}, diskW: map[string]float64{}, netR: map[string]float64{}, netT: map[string]float64{}}
}

type Sampler struct {
	run hostrun.Runner

	mu          sync.RWMutex
	prev, cur   *Sample
	rates       rates
	refreshedAt *time.Time
	lastErr     *string
}

func New(run hostrun.Runner) *Sampler { return &Sampler{run: run, rates: emptyRates()} }

// Start samples now, then Interval after each cycle ends.
func (s *Sampler) Start(stop <-chan struct{}) {
	go func() {
		for {
			s.Refresh(context.Background())
			select {
			case <-time.After(Interval):
			case <-stop:
				return
			}
		}
	}()
}

func (s *Sampler) Refresh(ctx context.Context) {
	res, err := s.run.Run(ctx, hostverb.Metrics())
	if err == nil {
		err = res.Err()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		msg := err.Error()
		log.Printf("metrics: cannot sample the host: %s", msg)
		s.lastErr = &msg
		return
	}
	s.ingest(Parse(res.Stdout, time.Now()))
}

func (s *Sampler) ingest(cur *Sample) {
	if s.cur != nil {
		s.rates = computeRates(s.cur, cur)
	} else {
		s.rates = emptyRates()
	}
	s.prev, s.cur = s.cur, cur
	now := time.Now()
	s.refreshedAt, s.lastErr = &now, nil
}

// Latest is the current sample, or nil before the first one.
func (s *Sampler) Latest() *Sample {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cur
}

func (s *Sampler) Perf() Perf {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p := Perf{
		CPU:          CPU{BusyFrac: s.rates.cpuBusy},
		Filesystems:  []Filesystem{},
		DiskReadBps:  s.rates.diskR,
		DiskWriteBps: s.rates.diskW,
		NetRxBps:     s.rates.netR,
		NetTxBps:     s.rates.netT,
		LastError:    s.lastErr,
	}
	if s.refreshedAt != nil {
		v := health.ISO(*s.refreshedAt)
		p.LastRefreshedAt = &v
	}
	if c := s.cur; c != nil {
		ms := c.SampledAt.UnixMilli()
		up := c.Uptime
		mem := c.Mem
		p.SampledAt, p.Uptime, p.Mem = &ms, &up, &mem
		p.CPU.Load1, p.CPU.Load5, p.CPU.Load15, p.CPU.Nproc = c.Load1, c.Load5, c.Load15, c.Nproc
		p.Filesystems = append(p.Filesystems, c.Filesystems...)
	}
	return p
}

var sectionRe = regexp.MustCompile(`^===([A-Z]+)===$`)

func splitSections(out string) map[string]string {
	sec := map[string]string{}
	var cur string
	var buf []string
	flush := func() {
		if cur != "" {
			sec[cur] = strings.Join(buf, "\n")
		}
	}
	for _, line := range strings.Split(out, "\n") {
		if m := sectionRe.FindStringSubmatch(strings.TrimRight(line, "\r")); m != nil {
			flush()
			cur, buf = m[1], nil
		} else if cur != "" {
			buf = append(buf, line)
		}
	}
	flush()
	return sec
}

func i64(s string) int64   { v, _ := strconv.ParseInt(s, 10, 64); return v }
func f64(s string) float64 { v, _ := strconv.ParseFloat(s, 64); return v }

var memRe = regexp.MustCompile(`^(\w+):\s+(\d+)\s*kB`)

// Parse reads one collection's output.
func Parse(out string, at time.Time) *Sample {
	sec := splitSections(out)
	s := &Sample{SampledAt: at}
	if f := strings.Fields(sec["UPTIME"]); len(f) > 0 {
		s.Uptime = f64(f[0])
	}
	if f := strings.Fields(sec["LOADAVG"]); len(f) >= 3 {
		s.Load1, s.Load5, s.Load15 = f64(f[0]), f64(f[1]), f64(f[2])
	}
	s.Nproc, _ = strconv.Atoi(strings.TrimSpace(sec["NPROC"]))
	if s.Nproc == 0 {
		s.Nproc = 1
	}
	kv := map[string]int64{}
	for _, line := range strings.Split(sec["MEMINFO"], "\n") {
		if m := memRe.FindStringSubmatch(line); m != nil {
			kv[m[1]] = i64(m[2]) * 1024
		}
	}
	s.Mem = Mem{kv["MemTotal"], kv["MemFree"], kv["MemAvailable"], kv["Buffers"], kv["Cached"], kv["SwapTotal"], kv["SwapFree"]}
	if f := strings.Fields(sec["STAT"]); len(f) >= 9 {
		s.cpu = cpuStat{i64(f[1]), i64(f[2]), i64(f[3]), i64(f[4]), i64(f[5]), i64(f[6]), i64(f[7]), i64(f[8])}
	}
	for _, line := range strings.Split(sec["DISKSTATS"], "\n") {
		f := strings.Fields(line)
		if len(f) < 10 {
			continue
		}
		dev := f[2]
		if strings.HasPrefix(dev, "loop") || strings.HasPrefix(dev, "ram") || strings.HasPrefix(dev, "dm-") {
			continue
		}
		s.disks = append(s.disks, diskStat{device: dev, sectorsRead: i64(f[5]), sectorsWritt: i64(f[9])})
	}
	for _, line := range strings.Split(sec["NETDEV"], "\n") {
		name, rest, ok := strings.Cut(line, ":")
		name = strings.TrimSpace(name)
		if !ok || name == "" || strings.ContainsAny(name, " |") || name == "lo" {
			continue
		}
		f := strings.Fields(rest)
		if len(f) < 16 {
			continue
		}
		s.nets = append(s.nets, netStat{iface: name, rx: i64(f[0]), tx: i64(f[8])})
	}
	lines := strings.Split(strings.TrimSpace(sec["DF"]), "\n")
	for i, line := range lines {
		if i == 0 {
			continue // header
		}
		f := strings.Fields(line)
		if len(f) < 5 {
			continue
		}
		s.Filesystems = append(s.Filesystems, Filesystem{Source: f[0], Target: f[1], SizeBytes: i64(f[2]), UsedBytes: i64(f[3]), AvailBytes: i64(f[4])})
	}
	return s
}

func computeRates(prev, cur *Sample) rates {
	r := emptyRates()
	dt := cur.SampledAt.Sub(prev.SampledAt).Seconds()
	if dt < 0.001 {
		dt = 0.001
	}
	dTotal := cur.cpu.total() - prev.cpu.total()
	dIdle := (cur.cpu.idle + cur.cpu.iowait) - (prev.cpu.idle + prev.cpu.iowait)
	if dTotal > 0 {
		b := 1 - float64(dIdle)/float64(dTotal)
		b = min(1, max(0, b))
		r.cpuBusy = &b
	}
	pd := map[string]diskStat{}
	for _, d := range prev.disks {
		pd[d.device] = d
	}
	for _, d := range cur.disks {
		if p, ok := pd[d.device]; ok {
			r.diskR[d.device] = float64((d.sectorsRead-p.sectorsRead)*sectorBytes) / dt
			r.diskW[d.device] = float64((d.sectorsWritt-p.sectorsWritt)*sectorBytes) / dt
		}
	}
	pn := map[string]netStat{}
	for _, n := range prev.nets {
		pn[n.iface] = n
	}
	for _, n := range cur.nets {
		if p, ok := pn[n.iface]; ok {
			r.netR[n.iface] = float64(n.rx-p.rx) / dt
			r.netT[n.iface] = float64(n.tx-p.tx) / dt
		}
	}
	return r
}

// Root is the filesystem holding /DATA — on a PCS, / itself (/DATA is a
// directory, not a mount). Nil until the first sample.
func (s *Sample) Root() *Filesystem {
	if s == nil {
		return nil
	}
	var best *Filesystem
	for i := range s.Filesystems {
		f := &s.Filesystems[i]
		if f.Target == "/DATA" {
			return f
		}
		if f.Target == "/" {
			best = f
		}
	}
	return best
}
