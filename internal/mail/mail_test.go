package mail

import (
	"bytes"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"testing"
)

func TestBuildWithAttachment(t *testing.T) {
	raw := SMTP{Domain: "alice.nsl.sh"}.Build(Message{
		To: "support@yundera.com", Subject: "[PCS Support] Où est mon app ?", Text: "bonjour",
		Attachments: []Attachment{{Filename: "yundera.log.gz", ContentType: "application/gzip", Content: []byte{0x1f, 0x8b, 1, 2}}},
	})
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	from, _ := mail.ParseAddress(msg.Header.Get("From"))
	if from.Address != "noreply@alice.nsl.sh" || from.Name != "PCS alice.nsl.sh" {
		t.Fatalf("from = %+v", from)
	}
	dec := new(mime.WordDecoder)
	if s, _ := dec.DecodeHeader(msg.Header.Get("Subject")); s != "[PCS Support] Où est mon app ?" {
		t.Fatalf("subject = %q", s)
	}
	_, params, _ := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	mr := multipart.NewReader(msg.Body, params["boundary"])
	var parts []string
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		parts = append(parts, p.Header.Get("Content-Type"))
	}
	if len(parts) != 2 || !strings.HasPrefix(parts[1], "application/gzip") {
		t.Fatalf("parts = %v", parts)
	}
}

func TestSendRefusesHeaderInjection(t *testing.T) {
	if err := (SMTP{Addr: "127.0.0.1:1"}).Send(Message{To: "a@x\r\nBcc: b@y"}); err == nil {
		t.Fatal("injected recipient accepted")
	}
}
