// Command yundera-admin is the Yundera layer of a PCS: the box's health check,
// the Yundera features its owner may switch off, support access, the first-run
// onboarding wizard, and the public routes the Yundera control plane polls and
// pushes to (/api/health, /api/perf, /api/bench/*, /api/identity/*). It sits
// behind the `admin` AppShield gate and serves an embedded Svelte UI plus a
// small JSON API.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/yundera/settings-center-app/internal/config"
	"github.com/yundera/settings-center-app/internal/server"
	"github.com/yundera/settings-center-app/internal/ui"
)

// subcommands run instead of the server: `yundera-admin <name> [args]`, for
// the template's self-check to reuse this image's code before the app is up.
var subcommands = map[string]func(args []string) int{}

func main() {
	if len(os.Args) > 1 {
		if run, ok := subcommands[os.Args[1]]; ok {
			os.Exit(run(os.Args[2:]))
		}
	}

	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("yundera-admin: ")

	cfg := config.FromEnv()
	stop := make(chan struct{})
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.New(cfg, ui.Dist(), stop),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("v%s listening on %s (yundera dir %s, host root %s)", server.Version, cfg.Addr, cfg.YunderaDir, cfg.YunderaHostRoot)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Print("shutting down")
	close(stop)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
