// Generates testdata/orchestrator-push.json with the orchestrator's OWN signing
// and encryption (pcs-orchestrator dist/library/identity/pcsToken.js), so the Go
// receiver is tested against the real producer. Regenerate after a contract change:
//   docker run --rm -v <pcs-orchestrator>:/orch:ro -v $PWD:/gen:ro -w /orch node:22 node /gen/gen.mjs > orchestrator-push.json
// (pcs-orchestrator built first: pnpm build).
import {generateKeyPairSync} from "crypto";
import {generateKeyPair, exportJWK} from "/orch/node_modules/jose/dist/webapi/index.js";
import {signIdentityBundle, encryptForBox} from "/orch/dist/library/identity/pcsToken.js";

const issuer = "https://issuer.test/service/pcs/auth";
const {privateKey, publicKey} = generateKeyPairSync("rsa", {modulusLength: 2048});
const signKey = {kid: "sig-1", privateKey};
const box = await generateKeyPair("ECDH-ES", {crv: "X25519", extractable: true});
const boxPub = await exportJWK(box.publicKey);
const boxPriv = await exportJWK(box.privateKey);
const bundle = {
  UID: "uid_ABC123", DOMAIN: "alice.nsl.sh", EMAIL: "alice@example.com", DOMAIN_UID: "alice",
  USER_JWT: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln",
  PROVIDER_STR: "https://nsl.sh,uid_ABC123,abc123DEF",
};
const jws = signIdentityBundle(bundle, "203.0.113.7", signKey, {issuer});
const jwe = await encryptForBox(jws, {kid: "box-1", jwk: {kty: boxPub.kty, crv: boxPub.crv, x: boxPub.x}});
const rsaJwk = publicKey.export({format: "jwk"});
const payload = JSON.parse(Buffer.from(jws.split(".")[1], "base64url"));
console.log(JSON.stringify({
  issuer, boxKid: "box-1", boxPrivateJwk: boxPriv,
  jwks: {keys: [{...rsaJwk, kid: "sig-1", alg: "RS256", use: "sig"}]},
  iat: payload.iat, host: "203.0.113.7", bundle, jwe,
}, null, 2));
