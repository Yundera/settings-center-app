package hostverb

import (
	"strings"
	"testing"
	"time"
)

var p = Paths{Scripts: "/DATA/AppData/yundera/template/scripts", Root: "/DATA/AppData/yundera"}

var hostile = []string{"$(id)", "a;b", "a`id`", "a|b", "a\nb", "../x", "a b", "-x", "'", "\"", strings.Repeat("a", 300)}

func TestPathsChecked(t *testing.T) {
	for _, bad := range []string{"", "/", "relative", "/DATA/../etc", "/DATA/$(id)", "/DATA/a b", "/DATA/x/"} {
		if _, err := SelfCheck(Paths{Scripts: bad, Root: p.Root}); err == nil {
			t.Errorf("scripts %q accepted", bad)
		}
		if _, err := SetEnv(Paths{Scripts: p.Scripts, Root: bad}, "UPDATE_URL", ""); err == nil {
			t.Errorf("root %q accepted", bad)
		}
	}
}

func TestSelfCheck(t *testing.T) {
	v, err := SelfCheck(p)
	if err != nil {
		t.Fatal(err)
	}
	if !v.Detached || strings.Join(v.Argv, " ") != "bash /DATA/AppData/yundera/template/scripts/self-check.sh" {
		t.Fatalf("verb = %+v", v)
	}
}

func TestSetEnv(t *testing.T) {
	v, err := SetEnv(p, "UPDATE_URL", "https://github.com/Yundera/template-root/archive/refs/heads/main.zip")
	if err != nil {
		t.Fatal(err)
	}
	want := "bash|/DATA/AppData/yundera/template/scripts/tools/env-file-manager.sh|set|UPDATE_URL|https://github.com/Yundera/template-root/archive/refs/heads/main.zip|/DATA/AppData/yundera/.pcs.env"
	if strings.Join(v.Argv, "|") != want {
		t.Fatalf("argv = %q", v.Argv)
	}
	for _, ok := range []string{"", "local", "file:///tmp/t.tar.gz", "http://x/y"} {
		if _, err := SetEnv(p, "UPDATE_URL", ok); err != nil {
			t.Errorf("UPDATE_URL %q refused: %v", ok, err)
		}
	}
	for _, bad := range append(hostile, "ftp://x", "https://x/'y", "https://x/$(id)") {
		if _, err := SetEnv(p, "UPDATE_URL", bad); err == nil {
			t.Errorf("UPDATE_URL %q accepted", bad)
		}
	}
	for _, ok := range []string{"0 3 * * *", "*/15 * * * *", "0 3,15 * * 1-5", "disabled", "off"} {
		if _, err := SetEnv(p, "SELF_CHECK_CRON", ok); err != nil {
			t.Errorf("cron %q refused: %v", ok, err)
		}
	}
	for _, bad := range append(hostile, "0 3 * *", "0 3 * * * *", "@daily", "0 3 * * MON") {
		if _, err := SetEnv(p, "SELF_CHECK_CRON", bad); err == nil {
			t.Errorf("cron %q accepted", bad)
		}
	}
	for _, key := range []string{"TRUST_ISSUER", "USER_JWT", "PATH", "ENSURE_SUPPORT_KEY"} {
		if _, err := SetEnv(p, key, "x"); err == nil {
			t.Errorf("key %s settable", key)
		}
	}
}

func TestFeature(t *testing.T) {
	v, err := Feature(p, "yundera-login", "disable")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(v.Argv, "|") != "bash|/DATA/AppData/yundera/template/scripts/tools/feature-yundera-login.sh|disable" {
		t.Fatalf("argv = %q", v.Argv)
	}
	for _, bad := range append(hostile, "", "unknown", "../feature-yundera-login") {
		if _, err := Feature(p, bad, "status"); err == nil {
			t.Errorf("feature %q accepted", bad)
		}
		if _, err := Feature(p, "support-key", bad); err == nil {
			t.Errorf("action %q accepted", bad)
		}
	}
}

func TestOnboarding(t *testing.T) {
	for _, ok := range [][]string{{"status"}, {"mark-completed"}, {"reset", "--confirm"}} {
		if _, err := Onboarding(p, ok...); err != nil {
			t.Errorf("%v refused: %v", ok, err)
		}
	}
	for _, bad := range [][]string{{"reset"}, {"run"}, {"status", "x"}, {"$(id)"}} {
		if _, err := Onboarding(p, bad...); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
}

func TestOnboardingRunPasswordOnStdinOnly(t *testing.T) {
	v, err := OnboardingRun(p, "alice", "Alice Martin", "correct horse", false)
	if err != nil {
		t.Fatal(err)
	}
	if string(v.Stdin) != "correct horse\n" {
		t.Fatalf("stdin = %q", v.Stdin)
	}
	for _, a := range v.Argv {
		if strings.Contains(a, "correct horse") {
			t.Fatalf("password leaked into argv: %q", v.Argv)
		}
	}
	if v.Argv[0] != "env" || v.Argv[1] != "ONBOARDING_USERNAME=alice" || v.Argv[2] != "ONBOARDING_DISPLAYNAME=Alice Martin" {
		t.Fatalf("argv = %q", v.Argv)
	}
	g, err := OnboardingRun(p, "alice", "Alice", "", true)
	if err != nil || g.Stdin == nil || len(g.Stdin) != 0 || !strings.Contains(strings.Join(g.Argv, " "), "ONBOARDING_GENERATE=1") {
		t.Fatalf("generate: %+v %v", g, err)
	}
	for _, bad := range hostile {
		if _, err := OnboardingRun(p, bad, "A", "longenough", false); err == nil {
			t.Errorf("username %q accepted", bad)
		}
	}
	for _, bad := range []string{"", "short", "two\nlines"} {
		if _, err := OnboardingRun(p, "alice", "A", bad, false); err == nil {
			t.Errorf("password %q accepted", bad)
		}
	}
	for _, bad := range []string{"", "  ", "a\x01b", strings.Repeat("é", 65)} {
		if _, err := OnboardingRun(p, "alice", bad, "longenough", false); err == nil {
			t.Errorf("displayname %q accepted", bad)
		}
	}
}

func TestApplyIdentityOnStdin(t *testing.T) {
	v, err := ApplyIdentity(p, []byte("UID=u\n"))
	if err != nil || string(v.Stdin) != "UID=u\n" || len(v.Argv) != 2 {
		t.Fatalf("%+v %v", v, err)
	}
}

func TestSupportVerbs(t *testing.T) {
	key := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJH5/bxj6fGPqTV1m7eF3r/ZpYnmcavc8fvSVpnZryug yundera-support"
	fp := "SHA256:a/9cbsC/49HDq44ZL9q9ij7lD56w1y3PPJ6tcXDa/Bs"
	v, err := SupportEnable("admin", key)
	if err != nil {
		t.Fatal(err)
	}
	// The script text is a constant; inputs are positional args after $0.
	if v.Argv[2] != supportEnableScript || v.Argv[4] != "admin" || strings.Contains(v.Argv[2], "AAAA") {
		t.Fatalf("argv = %q", v.Argv)
	}
	if _, err := SupportDisable("admin", fp); err != nil {
		t.Fatal(err)
	}
	if _, err := SupportStatus("admin"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range hostile {
		if _, err := SupportStatus(bad); err == nil {
			t.Errorf("user %q accepted", bad)
		}
		if _, err := SupportEnable("admin", bad); err == nil {
			t.Errorf("key %q accepted", bad)
		}
		if _, err := SupportDisable("admin", bad); err == nil {
			t.Errorf("fingerprint %q accepted", bad)
		}
	}
	if _, err := SupportEnable("admin", key+"\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJH5/bxj6fGPqTV1m7eF3r/Zp evil"); err == nil {
		t.Error("multi-line key accepted")
	}
}

func TestBackup(t *testing.T) {
	v, err := Backup(p, "reset", "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(v.Argv, "|") != "bash|/DATA/AppData/yundera/template/scripts/tools/backup.sh|reset|--confirm" || v.Stdin != nil {
		t.Fatalf("reset = %+v", v)
	}
	for _, ok := range []string{"status", "enable", "disable"} {
		v, err := Backup(p, ok, "")
		if err != nil || v.Argv[len(v.Argv)-1] != ok || v.Name != "backup-"+ok {
			t.Errorf("%s: %+v %v", ok, v, err)
		}
		if _, err := Backup(p, ok, "a long enough password"); err == nil {
			t.Errorf("%s accepted a password", ok)
		}
	}
	for _, bad := range append(hostile, "", "reset --confirm", "probe", "init kopia") {
		if _, err := Backup(p, bad, "a long enough password"); err == nil {
			t.Errorf("verb %q accepted", bad)
		}
	}
}

func TestBackupPasswordOnStdinOnly(t *testing.T) {
	const pw = "correct horse battery staple"
	for _, verb := range []string{"init", "recover"} {
		v, err := Backup(p, verb, pw)
		if err != nil {
			t.Fatal(err)
		}
		if string(v.Stdin) != pw+"\n" {
			t.Fatalf("%s stdin = %q", verb, v.Stdin)
		}
		if v.Timeout < 6*time.Minute {
			t.Fatalf("%s timeout %v is below Maison's own limit", verb, v.Timeout)
		}
		for _, a := range v.Argv {
			if strings.Contains(a, "horse") {
				t.Fatalf("password leaked into argv: %q", v.Argv)
			}
		}
		if strings.Join(v.Argv, "|") != "bash|/DATA/AppData/yundera/template/scripts/tools/backup.sh|"+verb {
			t.Fatalf("argv = %q", v.Argv)
		}
		for _, bad := range []string{"", "fifteen chars!!", "sixteen chars ok\nx", "sixteen chars ok\rx", "sixteen chars ok\x00"} {
			if _, err := Backup(p, verb, bad); err == nil {
				t.Errorf("%s password %q accepted", verb, bad)
			}
		}
	}
	if err := ValidateBackupPassword("ééééééééééééééé"); err != ErrBackupPasswordShort {
		t.Errorf("15 runes: %v", err)
	}
	if err := ValidateBackupPassword("éééééééééééééééé"); err != nil {
		t.Errorf("16 runes refused: %v", err)
	}
}
