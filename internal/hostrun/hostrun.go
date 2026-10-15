// Package hostrun runs host verbs: argv executed in the HOST's namespaces from
// a one-shot privileged sibling container, through the Docker socket.
//
// It replaces v1's SSH route (a key regenerated at every boot, written into
// /home/admin/.ssh/authorized_keys, ssh ControlMaster, tini to reap what the
// multiplexer orphaned). This process already holds the Docker socket, which is
// root on the host, so a privileged sibling adds no power — it only gives the
// verb the host's view. Same mechanism as mesh-console and auth-console
// (internal/dockerx RunOnHost), with two additions this app needs:
//
//   - stdin: the onboarding password and the pushed identity values reach the
//     host script on stdin, never in argv (argv is visible in `ps` and in
//     `docker inspect` of the runner).
//   - concurrency: the metrics sampler, a page load and a self-check can
//     overlap, so runners get unique names and an in-process semaphore bounds
//     them, instead of mesh-console's single fixed name.
//
// A runner is in no compose project, so a self-check's `up --remove-orphans`
// never removes it, and it keeps running if this container is recreated
// mid-verb — which the self-check it starts may well do.
package hostrun

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

// Label marks every runner, so leftovers can be found and removed.
const Label = "yundera-admin.runner"

// Spec is one host action.
type Spec struct {
	// Name is a short slug for the container name and the logs.
	Name string
	Argv []string
	// Stdin, when non-nil, is written to the process's stdin, then closed.
	Stdin []byte
	// Detached starts the verb and returns at once; the container removes
	// itself when done. Output is lost — a detached verb reports through its
	// own log (the self-check writes yundera.log).
	Detached bool
	// Timeout bounds a synchronous verb. Zero means 10 minutes.
	Timeout time.Duration
}

// Result is a synchronous verb's outcome. Stdout may carry a one-time password
// (onboarding run): it is never logged.
type Result struct {
	ExitCode int64
	Stdout   string
	Stderr   string
}

// OK reports a zero exit.
func (r *Result) OK() bool { return r != nil && r.ExitCode == 0 }

// Err turns a non-zero exit into an error carrying stderr (or stdout when the
// script wrote its reason there), the way v1's LocalExecutor did:
// "Command failed with code N: <text>".
func (r *Result) Err() error {
	if r.OK() {
		return nil
	}
	msg := strings.TrimSpace(r.Stderr)
	if msg == "" {
		msg = strings.TrimSpace(r.Stdout)
	}
	return fmt.Errorf("command failed with code %d: %s", r.ExitCode, msg)
}

// Runner is what the rest of the app depends on, so tests can fake the host.
type Runner interface {
	Run(ctx context.Context, s Spec) (*Result, error)
}

// ErrUnavailable means there is no Docker socket (a dev run without one).
var ErrUnavailable = errors.New("host actions are unavailable: no Docker socket")

// MaxConcurrent bounds runners started by this process.
const MaxConcurrent = 3

type Docker struct {
	cli *client.Client
	// image is the runner image: this container's own (it ships nsenter).
	image   string
	imageMu sync.Mutex
	self    string
	sem     chan struct{}
}

// New connects to the socket. selfContainer names this container, so the
// runner reuses its exact image; image, when set, overrides that lookup.
func New(selfContainer, image string) (*Docker, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	d := &Docker{cli: cli, self: selfContainer, image: image, sem: make(chan struct{}, MaxConcurrent)}
	return d, nil
}

// Sweep removes runners a previous process left stopped (a verb whose cleanup
// was cut short by a restart). Running ones are left alone: they may be a
// self-check that outlived the container that started it.
func (d *Docker) Sweep(ctx context.Context) {
	list, err := d.cli.ContainerList(ctx, container.ListOptions{
		All:     true,
		Filters: filters.NewArgs(filters.Arg("label", Label+"=true"), filters.Arg("status", "exited"), filters.Arg("status", "created")),
	})
	if err != nil {
		return
	}
	for _, c := range list {
		_ = d.cli.ContainerRemove(ctx, c.ID, container.RemoveOptions{Force: true})
	}
}

func (d *Docker) runnerImage(ctx context.Context) (string, error) {
	d.imageMu.Lock()
	defer d.imageMu.Unlock()
	if d.image != "" {
		return d.image, nil
	}
	info, err := d.cli.ContainerInspect(ctx, d.self)
	if err != nil {
		return "", fmt.Errorf("cannot find this container (%s) to reuse its image: %w", d.self, err)
	}
	if info.Config == nil || info.Config.Image == "" {
		return "", errors.New("this container has no image")
	}
	d.image = info.Config.Image
	return d.image, nil
}

// Run executes s on the host.
//
// ctx must NOT be the HTTP request's for a verb that changes anything: a client
// that navigates away would cancel the wait and the deferred force-remove would
// kill the verb half way through (an authorized_keys rewrite, an env write).
// Callers pass context.WithoutCancel(r.Context()) or a background context.
func (d *Docker) Run(ctx context.Context, s Spec) (*Result, error) {
	timeout := s.Timeout
	if timeout == 0 {
		timeout = 10 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	select {
	case d.sem <- struct{}{}:
	case <-ctx.Done():
		return nil, fmt.Errorf("%s: waited too long for a free runner: %w", s.Name, ctx.Err())
	}
	release := func() { <-d.sem }
	if !s.Detached {
		defer release()
	}

	image, err := d.runnerImage(ctx)
	if err != nil {
		if s.Detached {
			release()
		}
		return nil, err
	}
	name := "admin-runner-" + slug(s.Name) + "-" + randHex(4)
	cfg := &container.Config{
		Image: image,
		// Entrypoint is set, not cleared: an empty override is dropped by the
		// API (omitempty) and the image's own entrypoint — this binary — would
		// run with argv as its arguments.
		Entrypoint: []string{"nsenter"},
		Cmd:        append([]string{"-t", "1", "-m", "-u", "-i", "-n", "-p", "--"}, s.Argv...),
		Labels:     map[string]string{Label: "true", Label + ".verb": slug(s.Name)},
	}
	if s.Stdin != nil {
		cfg.OpenStdin, cfg.StdinOnce, cfg.AttachStdin = true, true, true
	}
	created, err := d.cli.ContainerCreate(ctx, cfg, &container.HostConfig{
		Privileged:  true,
		PidMode:     "host",
		NetworkMode: "none",
		AutoRemove:  s.Detached,
	}, nil, nil, name)
	if err != nil {
		if s.Detached {
			release()
		}
		return nil, err
	}
	bg := context.WithoutCancel(ctx)
	if !s.Detached {
		defer func() { _ = d.cli.ContainerRemove(bg, created.ID, container.RemoveOptions{Force: true}) }()
	}

	// Attach before start so not a byte of stdin can be missed.
	var stdinDone chan error
	if s.Stdin != nil {
		hj, err := d.cli.ContainerAttach(ctx, created.ID, container.AttachOptions{Stream: true, Stdin: true})
		if err != nil {
			return nil, fmt.Errorf("%s: attach stdin: %w", s.Name, err)
		}
		defer hj.Close()
		stdinDone = make(chan error, 1)
		go func() {
			_, werr := hj.Conn.Write(s.Stdin)
			if cerr := hj.CloseWrite(); werr == nil {
				werr = cerr
			}
			stdinDone <- werr
		}()
	}

	if err := d.cli.ContainerStart(ctx, created.ID, container.StartOptions{}); err != nil {
		if s.Detached {
			_ = d.cli.ContainerRemove(bg, created.ID, container.RemoveOptions{Force: true})
			release()
		}
		return nil, err
	}
	if s.Detached {
		// The slot is held until the verb is gone, so a burst of detached
		// starts cannot exceed the bound either.
		go func() {
			defer release()
			wctx, wcancel := context.WithTimeout(bg, 6*time.Hour)
			defer wcancel()
			sc, ec := d.cli.ContainerWait(wctx, created.ID, container.WaitConditionRemoved)
			select {
			case <-sc:
			case <-ec:
			}
		}()
		return nil, nil
	}

	statusCh, errCh := d.cli.ContainerWait(ctx, created.ID, container.WaitConditionNotRunning)
	var code int64
	select {
	case err := <-errCh:
		if err != nil {
			return nil, fmt.Errorf("%s: %w", s.Name, err)
		}
	case st := <-statusCh:
		code = st.StatusCode
	}
	if stdinDone != nil {
		select {
		case <-stdinDone:
		default:
		}
	}
	rc, err := d.cli.ContainerLogs(bg, created.ID, container.LogsOptions{ShowStdout: true, ShowStderr: true})
	if err != nil {
		return &Result{ExitCode: code}, nil
	}
	defer rc.Close()
	var stdout, stderr bytes.Buffer
	_, _ = stdcopy.StdCopy(&stdout, &stderr, rc)
	return &Result{ExitCode: code, Stdout: stdout.String(), Stderr: tail(stderr.String(), 8000)}, nil
}

// Unavailable is the Runner used when there is no socket.
type Unavailable struct{}

func (Unavailable) Run(context.Context, Spec) (*Result, error) { return nil, ErrUnavailable }

func slug(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "verb"
	}
	if len(out) > 32 {
		out = out[:32]
	}
	return out
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func tail(s string, n int) string {
	if len(s) > n {
		return "…" + s[len(s)-n:]
	}
	return s
}

// DecodeJSON reads a verb's JSON answer from stdout: the whole of it, or else
// its last line (a script may log before answering).
func DecodeJSON(stdout string, v any) error {
	text := strings.TrimSpace(stdout)
	if text == "" {
		return errors.New("no output")
	}
	if json.Unmarshal([]byte(text), v) == nil {
		return nil
	}
	if i := strings.LastIndexByte(text, '\n'); i >= 0 {
		if err := json.Unmarshal([]byte(strings.TrimSpace(text[i+1:])), v); err == nil {
			return nil
		}
	}
	return fmt.Errorf("unparseable output: %.200s", text)
}
