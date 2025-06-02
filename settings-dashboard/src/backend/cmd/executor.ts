import { spawn } from 'child_process';
import { Readable } from 'stream';

export async function execute(cmd: string,verbose=true): Promise<{ stdout: string, stderr: string }> {
    if(verbose){
        console.log(`Executing command: ${cmd}`);
    }

    const child = spawn('/bin/sh', ['-c', cmd]);

    let stdout = '';
    let stderr = '';

    // Create async iterators for the streams
    const processStream = async (stream: Readable, output: NodeJS.WriteStream) => {
        for await (const chunk of stream) {
            const text = chunk.toString();
            output.write(text);
            return text;
        }
    };

    // Process both streams concurrently
    const [stdoutResult, stderrResult] = await Promise.all([
        // Process stdout
        (async () => {
            for await (const chunk of child.stdout) {
                const text = chunk.toString();
                stdout += text;
                if(verbose) {
                    process.stdout.write(text);
                }
            }
        })(),
        // Process stderr
        (async () => {
            for await (const chunk of child.stderr) {
                const text = chunk.toString();
                stderr += text;
                if(verbose) {
                    process.stderr.write(text);
                }
            }
        })()
    ]);

    // Wait for process to complete
    return new Promise((resolve, reject) => {
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(`Command failed with code ${code}`));
            }
        });

        child.on('error', reject);
    });
}