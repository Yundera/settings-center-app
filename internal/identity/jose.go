package identity

// The two JOSE operations the push needs, written against the standard
// library: decrypting a compact JWE (ECDH-ES direct key agreement over X25519,
// A256GCM content encryption — RFC 7518 §4.6 and §5.3) and verifying a compact
// RS256 JWS. One algorithm each, so a JOSE library would be the largest
// dependency in the binary; testdata/orchestrator-push.json pins both against
// the orchestrator's own jose / jsonwebtoken output.

import (
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
)

var b64 = base64.RawURLEncoding

type jweHeader struct {
	Alg string `json:"alg"`
	Enc string `json:"enc"`
	Kid string `json:"kid"`
	Zip string `json:"zip"`
	Apu string `json:"apu"`
	Apv string `json:"apv"`
	Epk *struct {
		Kty string `json:"kty"`
		Crv string `json:"crv"`
		X   string `json:"x"`
	} `json:"epk"`
}

// jweKid reads the kid from a compact JWE's protected header without
// decrypting anything.
func jweKid(jwe string) (string, error) {
	parts := strings.Split(jwe, ".")
	if len(parts) != 5 {
		return "", errors.New("not a compact JWE")
	}
	var h jweHeader
	if err := decodeJSON(parts[0], &h); err != nil {
		return "", err
	}
	return h.Kid, nil
}

// decryptJWE opens a compact JWE with priv. Only alg ECDH-ES (direct, so the
// encrypted-key part is empty) with enc A256GCM over an X25519 epk is accepted.
func decryptJWE(jwe string, priv *ecdh.PrivateKey) ([]byte, error) {
	parts := strings.Split(jwe, ".")
	if len(parts) != 5 {
		return nil, errors.New("not a compact JWE")
	}
	var h jweHeader
	if err := decodeJSON(parts[0], &h); err != nil {
		return nil, err
	}
	if h.Alg != "ECDH-ES" || h.Enc != "A256GCM" || h.Zip != "" || parts[1] != "" {
		return nil, errors.New("unsupported JWE algorithms")
	}
	if h.Epk == nil || h.Epk.Kty != "OKP" || h.Epk.Crv != "X25519" {
		return nil, errors.New("JWE epk is not an X25519 key")
	}
	epkRaw, err := b64.DecodeString(h.Epk.X)
	if err != nil {
		return nil, err
	}
	epk, err := ecdh.X25519().NewPublicKey(epkRaw)
	if err != nil {
		return nil, err
	}
	z, err := priv.ECDH(epk) // rejects low-order points (an all-zero secret)
	if err != nil {
		return nil, err
	}
	apu, err := b64.DecodeString(h.Apu)
	if err != nil {
		return nil, err
	}
	apv, err := b64.DecodeString(h.Apv)
	if err != nil {
		return nil, err
	}
	cek := concatKDF(z, h.Enc, apu, apv, 256)

	iv, err := b64.DecodeString(parts[2])
	if err != nil || len(iv) != 12 {
		return nil, errors.New("bad JWE iv")
	}
	ct, err := b64.DecodeString(parts[3])
	if err != nil {
		return nil, err
	}
	tag, err := b64.DecodeString(parts[4])
	if err != nil || len(tag) != 16 {
		return nil, errors.New("bad JWE tag")
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	// The additional authenticated data is the ASCII of the encoded header.
	return gcm.Open(nil, iv, append(ct, tag...), []byte(parts[0]))
}

// concatKDF is the single-step KDF of NIST SP 800-56A §5.8.1 as JOSE profiles
// it (RFC 7518 §4.6.2): for direct ECDH-ES the AlgorithmID is the enc value.
func concatKDF(z []byte, algID string, apu, apv []byte, keyBits int) []byte {
	lenPrefixed := func(b []byte) []byte {
		out := make([]byte, 4+len(b))
		binary.BigEndian.PutUint32(out, uint32(len(b)))
		copy(out[4:], b)
		return out
	}
	var other []byte
	other = append(other, lenPrefixed([]byte(algID))...)
	other = append(other, lenPrefixed(apu)...)
	other = append(other, lenPrefixed(apv)...)
	other = binary.BigEndian.AppendUint32(other, uint32(keyBits))

	need := keyBits / 8
	var out []byte
	for counter := uint32(1); len(out) < need; counter++ {
		h := sha256.New()
		_ = binary.Write(h, binary.BigEndian, counter)
		h.Write(z)
		h.Write(other)
		out = h.Sum(out)
	}
	return out[:need]
}

type jwsHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
	Kid string `json:"kid"`
}

// splitJWS returns the header, the raw payload and the signing input of a
// compact JWS, without verifying it.
func splitJWS(jws string) (h jwsHeader, payload []byte, signed string, sig []byte, err error) {
	parts := strings.Split(jws, ".")
	if len(parts) != 3 {
		return h, nil, "", nil, errors.New("not a compact JWS")
	}
	if err = decodeJSON(parts[0], &h); err != nil {
		return h, nil, "", nil, err
	}
	if payload, err = b64.DecodeString(parts[1]); err != nil {
		return h, nil, "", nil, err
	}
	if sig, err = b64.DecodeString(parts[2]); err != nil {
		return h, nil, "", nil, err
	}
	return h, payload, parts[0] + "." + parts[1], sig, nil
}

func verifyRS256(pub *rsa.PublicKey, signed string, sig []byte) error {
	sum := sha256.Sum256([]byte(signed))
	return rsa.VerifyPKCS1v15(pub, crypto.SHA256, sum[:], sig)
}

// jwk is the subset of a JWKS entry this receiver reads.
type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func (k jwk) rsaPublic() (*rsa.PublicKey, error) {
	if k.Kty != "RSA" {
		return nil, errors.New("not an RSA key")
	}
	n, err := b64.DecodeString(k.N)
	if err != nil {
		return nil, err
	}
	e, err := b64.DecodeString(k.E)
	if err != nil {
		return nil, err
	}
	pub := &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	if pub.N.BitLen() < 2048 || pub.E < 3 {
		return nil, errors.New("RSA key too weak")
	}
	return pub, nil
}

func decodeJSON(seg string, v any) error {
	raw, err := b64.DecodeString(seg)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}
