import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import * as ed25519 from '@noble/ed25519';

// Step 1: Create or use existing WebAuthn credential
async function getWebAuthnCredential(appId:string = "Yundera" ,userId: string = '12345678', userName: string = 'UserName', userDisplayName: string = 'User') {
    // Define a consistent RP ID - typically your domain
    const rpId = window.location.hostname;
    if (!rpId) {
        throw new Error('RP ID is not defined.');
    }

    try {
        console.log('Attempting WebAuthn authentication...');
        return await startAuthentication({
            optionsJSON: {
                challenge: crypto.randomUUID(),
                rpId: rpId,  // Explicitly set the RP ID for authentication
                allowCredentials: [],
                userVerification: 'preferred',
                timeout: 60000
            }
        });
    } catch (e) {
        console.log('Authentication failed, attempting registration:', e);

        return await startRegistration({
            optionsJSON: {
                challenge: crypto.randomUUID(),
                rp: {
                    name: appId,
                    id: rpId
                },
                user: {
                    id: userId,
                    name: userName,
                    displayName: userDisplayName
                },
                pubKeyCredParams: [
                    { alg: -7, type: 'public-key' },
                    { alg: -257, type: 'public-key' }
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    userVerification: 'preferred',
                    // Set requireResidentKey to true for better results
                    // when not storing credential IDs
                    requireResidentKey: true,
                    residentKey: 'required'
                },
                timeout: 60000,
                attestation: 'none'
            }
        });
    }
}


// Step 2: Sign a known message with WebAuthn
export async function signWithWebAuthn(message: string) {
    // Get WebAuthn credential for signing
    const rpId = window.location.hostname;

    // Use the credential to sign the message
    // WebAuthn doesn't directly sign arbitrary messages, so we'll use the challenge mechanism
    // Create a new authentication request with our message as the challenge
    const signResult = await startAuthentication({
        optionsJSON: {
            challenge: message, // Base64 encode message as challenge
            rpId: rpId,  // Explicitly set the RP ID for authentication
            allowCredentials: [],
            userVerification: 'preferred',
            timeout: 60000
        }
    });

    return signResult.response.signature;
}

// Step 3: Derive SSH key from WebAuthn signature
/*async function deriveSSHKey(signature: ArrayBuffer) {
    // Use HKDF to derive a deterministic key from the signature
    const derivedKey = await hkdf.compute(
        new Uint8Array(signature),
        'SHA-256',
        32,
        'SSH Key Derivation',
        new Uint8Array([])
    );

    // Use the derived key as seed for Ed25519 key generation
    const privateKey = ed25519.utils.randomPrivateKey(derivedKey.key);
    const publicKey = await ed25519.getPublicKey(privateKey);

    // Format keys manually for OpenSSH format
    return {
        privateKeyOpenSSH: formatOpenSSHPrivateKey(privateKey, publicKey),
        publicKeyOpenSSH: formatOpenSSHPublicKey(publicKey)
    };
}

// Format public key to OpenSSH format
function formatOpenSSHPublicKey(publicKey: Uint8Array): string {
    const keyType = 'ssh-ed25519';
    const keyTypeBuffer = new TextEncoder().encode(keyType);

    // Create buffer in SSH format (length-prefixed fields)
    const keyBuffer = new Uint8Array([
        ...new Uint32Array([keyTypeBuffer.length]).buffer,
        ...keyTypeBuffer,
        ...new Uint32Array([publicKey.length]).buffer,
        ...publicKey
    ]);

    // Base64 encode the result
    const base64Key = btoa(String.fromCharCode(...keyBuffer));

    return `${keyType} ${base64Key} derived-webauthn-key`;
}

// Format private key to OpenSSH PEM format
// Note: This is a simplified version. A complete implementation would follow the
// OpenSSH private key format specification in detail
function formatOpenSSHPrivateKey(privateKey: Uint8Array, publicKey: Uint8Array): string {
    // For Bitwarden compatibility, we'll create a PEM-encoded private key
    // This is a simplified approach and might need refinements

    const keyType = 'ssh-ed25519';
    const keyData = new Uint8Array([
        ...privateKey,
        ...publicKey
    ]);

    // Base64 encode the key data
    let base64Key = btoa(String.fromCharCode(...keyData));

    // Format as PEM
    let pemKey = '-----BEGIN OPENSSH PRIVATE KEY-----\n';

    // Split base64 into 64-character lines
    while (base64Key.length > 64) {
        pemKey += base64Key.substring(0, 64) + '\n';
        base64Key = base64Key.substring(64);
    }

    if (base64Key.length > 0) {
        pemKey += base64Key + '\n';
    }

    pemKey += '-----END OPENSSH PRIVATE KEY-----';

    return pemKey;
}

*/

