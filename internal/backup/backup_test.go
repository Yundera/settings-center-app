package backup

import (
	"errors"
	"testing"
)

func TestCode(t *testing.T) {
	for msg, want := range map[string]string{
		"command failed with code 1: ERROR: Error: the key does not open this repository [wrong_key]": "wrong_key",
		"ERROR: kopia refused [repository_exists]":                                                    "repository_exists",
		"ERROR: CONFIRM_MISMATCH: confirm does not match":                                             "confirm_mismatch",
		"ERROR: RESET_RATE_LIMIT: too many resets today for this account; try again tomorrow":         "rate_limited",
		"ERROR: NO_BACKUP_SPACE: no backup space to reset":                                            "no_backup_space",
		"ERROR: UNREACHABLE: could not reach https://app.yundera.com/service/pcs":                     "unreachable",
		"ERROR: CONFLICT: the backup space cannot be reset right now":                                 "reset_busy",
		"ERROR: reset is only for a PCS whose backups need recovery (current state: ready)":           "not_awaiting_secret",
		"ERROR: backups are disabled on this PCS; enable them first":                                  "backup_disabled",
		"command failed with code 1: ERROR: wrong_key: the password does not open this repository":    "wrong_key",
		"command failed with code 14: ERROR: wrong password":                                          "wrong_key",
		"ERROR: repository_exists":                                                                    "repository_exists",
		"ERROR: kopia: found existing data in storage":                                                "repository_exists",
		"ERROR: not_awaiting_secret: engine kopia is not waiting for a password":                      "not_awaiting_secret",
		"ERROR: too_short":                 "too_short",
		"ERROR: reset refused (HTTP 429)":  "rate_limited",
		"ERROR: maison-app is not running": "backup_failed",
	} {
		if got := Code(errors.New(msg)); got != want {
			t.Errorf("%q → %s, want %s", msg, got, want)
		}
	}
	if Code(nil) != "" {
		t.Error("nil error has a code")
	}
}

func TestSettled(t *testing.T) {
	for state, want := range map[string]bool{Ready: true, Disabled: true, NeedsSecret: false, NeedsRecovery: false, Unavailable: false, "": false} {
		if (Status{State: state}).Settled() != want {
			t.Errorf("%q settled != %v", state, want)
		}
	}
}
