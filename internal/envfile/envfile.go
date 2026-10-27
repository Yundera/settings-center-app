// Package envfile reads the template's env files the way its scripts do: line
// by line, never sourced (template/scripts/library/common.sh).
//
// They are read from the read-only mount on every request rather than taken
// from this container's environment. The container env is a snapshot from its
// last recreate; the file is what the next self-check will actually use.
package envfile

import (
	"bufio"
	"errors"
	"io/fs"
	"os"
	"strings"
)

type Env map[string]string

// Load parses one env file. A missing file is an empty Env, not an error:
// .pcs.env keys are all optional.
func Load(path string) (Env, error) {
	f, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return Env{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	env := Env{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		if k, v, ok := ParseLine(sc.Text()); ok {
			env[k] = v
		}
	}
	return env, sc.Err()
}

// ParseLine handles KEY=value, optional `export `, surrounding quotes, and
// skips comments and blanks.
func ParseLine(line string) (key, value string, ok bool) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false
	}
	line = strings.TrimPrefix(line, "export ")
	k, v, found := strings.Cut(line, "=")
	if !found {
		return "", "", false
	}
	k = strings.TrimSpace(k)
	if k == "" {
		return "", "", false
	}
	v = strings.TrimSpace(v)
	if len(v) >= 2 && (v[0] == '"' && v[len(v)-1] == '"' || v[0] == '\'' && v[len(v)-1] == '\'') {
		v = v[1 : len(v)-1]
	}
	return k, v, true
}

// Get returns the first non-empty value among keys.
func (e Env) Get(keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(e[k]); v != "" {
			return v
		}
	}
	return ""
}

// Dash turns an IP into the form used in ip.<zone> / sslip.io hostnames, as
// ensure-public-ip.sh derives PUBLIC_IP_DASH.
func Dash(ip string) string {
	return strings.NewReplacer(".", "-", ":", "-").Replace(ip)
}
