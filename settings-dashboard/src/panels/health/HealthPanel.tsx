import { PageContainer } from "dashboard-core";
import { Button, TextField, Box, Typography, CircularProgress } from "@mui/material";
import { useState } from "react";
import * as forge from "node-forge";

export const HealthPanel = () => {
    const [password, setPassword] = useState("");
    const [keyPair, setKeyPair] = useState({ privateKey: "", publicKey: "" });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const generateSSHKeyPair = async () => {
        if (!password) {
            setError("Please enter a password");
            return;
        }

        setLoading(true);
        setError("");

        try {
            // Generate a salt
            const salt = forge.random.getBytesSync(16);

            // Derive a key using PBKDF2
            const derivedKey = forge.pkcs5.pbkdf2(
                password,
                salt,
                10000, // iterations
                32     // key size in bytes
            );

            // Generate RSA key pair using the derived key as a seed
            const rsa = forge.pki.rsa;
            const keypair:any = await new Promise((resolve, reject) => {
                rsa.generateKeyPair(
                    {
                        bits: 2048,
                        seed: derivedKey,
                        workers: 2
                    },
                    (err, keypair) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(keypair);
                        }
                    }
                );
            });

            // Convert to PEM format
            const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
            const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);

            // Convert public key to SSH format
            const publicKeySSH = convertToSSHPublicKey(keypair.publicKey);

            setKeyPair({
                privateKey: privateKeyPem,
                publicKey: publicKeySSH
            });

        } catch (err) {
            console.error("Error generating key pair:", err);
            setError("Failed to generate key pair: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    // Function to convert RSA public key to SSH format
    const convertToSSHPublicKey = (publicKey) => {
        // Get the modulus and exponent
        const n = publicKey.n;
        const e = publicKey.e;

        // Convert to SSH format
        const sshKey = forge.ssh.publicKeyToOpenSSH(publicKey);
        return sshKey;
    };

    const downloadKey = (content, filename) => {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const downloadPrivateKey = () => {
        downloadKey(keyPair.privateKey, 'id_rsa');
    };

    const downloadPublicKey = () => {
        downloadKey(keyPair.publicKey, 'id_rsa.pub');
    };

    return (
        <PageContainer>
            <Box sx={{ maxWidth: 600, margin: '0 auto' }}>
                <Typography variant="h5" gutterBottom>
                    Generate SSH Key Pair
                </Typography>

                <Box sx={{ mb: 3 }}>
                    <TextField
                        fullWidth
                        label="Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        margin="normal"
                        helperText="Enter a strong password to derive your SSH key pair"
                    />

                    <Button
                        variant="contained"
                        color="primary"
                        onClick={generateSSHKeyPair}
                        disabled={loading || !password}
                        sx={{ mt: 2 }}
                    >
                        {loading ? <CircularProgress size={24} /> : "Generate SSH Key Pair"}
                    </Button>

                    {error && (
                        <Typography color="error" sx={{ mt: 1 }}>
                            {error}
                        </Typography>
                    )}
                </Box>

                {keyPair.privateKey && (
                    <Box sx={{ mt: 4 }}>
                        <Typography variant="h6" gutterBottom>
                            Key Pair Generated
                        </Typography>

                        <Typography>
                            This part allows you to generate an SSH key pair using a master password.
                            The private key is derived from the password using PBKDF2 and is used to generate the RSA key pair.
                            The public key is converted to SSH format for easy use with SSH servers.
                        </Typography>
                        <Button
                            variant="outlined"
                            color="secondary"
                            onClick={downloadPrivateKey}
                            sx={{ mr: 2, mb: 2 }}
                        >
                            Download Private Key
                        </Button>

                        <Button
                            variant="outlined"
                            color="secondary"
                            onClick={downloadPublicKey}
                        >
                            Download Public Key
                        </Button>

                        <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
                            Public Key Preview:
                        </Typography>
                        <Box
                            component="pre"
                            sx={{
                                bgcolor: 'grey.100',
                                p: 2,
                                borderRadius: 1,
                                overflow: 'auto',
                                fontSize: '0.8rem',
                                maxHeight: '100px'
                            }}
                        >
                            {keyPair.publicKey}
                        </Box>
                    </Box>
                )}
            </Box>
        </PageContainer>
    );
};