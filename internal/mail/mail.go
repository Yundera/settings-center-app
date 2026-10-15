// Package mail sends this box's own messages to Yundera — support reports and
// Maison's feedback — through the mesh's SMTP relay (`smtp` on pcs, port 587,
// no auth: the relay signs and forwards). Port of v1's operatorMail.ts, which
// used nodemailer with STARTTLS without certificate verification, and none on
// port 25.
package mail

import (
	"bytes"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"
)

type Attachment struct {
	Filename    string
	ContentType string
	Content     []byte
}

type Message struct {
	To          string
	Subject     string
	Text        string
	Attachments []Attachment
}

// Sender is what handlers depend on, so tests can capture mail.
type Sender interface {
	Send(Message) error
}

type SMTP struct {
	Addr   string // host:port
	Domain string // the box's domain: From is noreply@<domain>
}

func (s SMTP) from() (display, addr string) {
	d := s.Domain
	if d == "" {
		d = "unknown-pcs"
	}
	return "PCS " + d, "noreply@" + d
}

// Build renders msg as an RFC 5322 message.
func (s SMTP) Build(msg Message) []byte {
	display, addr := s.from()
	var b bytes.Buffer
	h := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, v) }
	h("From", mime.QEncoding.Encode("utf-8", display)+" <"+addr+">")
	h("To", msg.To)
	h("Subject", mime.QEncoding.Encode("utf-8", msg.Subject))
	h("Date", time.Now().Format(time.RFC1123Z))
	h("Message-ID", "<"+randHex(12)+"@"+strings.TrimPrefix(addr, "noreply@")+">")
	h("MIME-Version", "1.0")
	text := base64Lines([]byte(msg.Text))
	if len(msg.Attachments) == 0 {
		h("Content-Type", `text/plain; charset="utf-8"`)
		h("Content-Transfer-Encoding", "base64")
		b.WriteString("\r\n" + text)
		return b.Bytes()
	}
	boundary := "=_" + randHex(16)
	h("Content-Type", `multipart/mixed; boundary="`+boundary+`"`)
	b.WriteString("\r\n--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"utf-8\"\r\nContent-Transfer-Encoding: base64\r\n\r\n" + text)
	for _, a := range msg.Attachments {
		name := mime.QEncoding.Encode("utf-8", a.Filename)
		b.WriteString("--" + boundary + "\r\n")
		fmt.Fprintf(&b, "Content-Type: %s; name=\"%s\"\r\n", a.ContentType, name)
		fmt.Fprintf(&b, "Content-Disposition: attachment; filename=\"%s\"\r\n", name)
		b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n" + base64Lines(a.Content))
	}
	b.WriteString("--" + boundary + "--\r\n")
	return b.Bytes()
}

func (s SMTP) Send(msg Message) error {
	if strings.ContainsAny(msg.To, "\r\n") {
		return fmt.Errorf("bad recipient")
	}
	host, port, err := net.SplitHostPort(s.Addr)
	if err != nil {
		return err
	}
	conn, err := net.DialTimeout("tcp", s.Addr, 15*time.Second)
	if err != nil {
		return err
	}
	_ = conn.SetDeadline(time.Now().Add(60 * time.Second))
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if err := c.Hello("admin-app"); err != nil {
		return err
	}
	if ok, _ := c.Extension("STARTTLS"); ok && port != "25" {
		// The relay is on the pcs network with a self-signed certificate.
		if err := c.StartTLS(&tls.Config{ServerName: host, InsecureSkipVerify: true}); err != nil {
			return err
		}
	}
	_, from := s.from()
	if err := c.Mail(from); err != nil {
		return err
	}
	if err := c.Rcpt(msg.To); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(s.Build(msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func base64Lines(b []byte) string {
	enc := base64.StdEncoding.EncodeToString(b)
	var out strings.Builder
	for len(enc) > 76 {
		out.WriteString(enc[:76] + "\r\n")
		enc = enc[76:]
	}
	out.WriteString(enc + "\r\n")
	return out.String()
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
