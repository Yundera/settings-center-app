import {NextApiRequest, NextApiResponse} from 'next'
import {authMiddleware} from "@/backend/auth/middleware";
import {executeHostCommand} from "@/backend/cmd/HostExecutor";

export interface DockerContainer {
    name: string;
    image: string;
    ports: string[];
}

function parseContainerPorts(portsStr: string): string[] {
    if (!portsStr) return [];
    const set = new Set<string>();
    portsStr.split(',').map(s => s.trim()).forEach(p => {
        // Matches "80/tcp" or "0.0.0.0:8080->80/tcp" → captures container port (80)
        const match = p.match(/(\d+)\/(?:tcp|udp)\s*$/);
        if (match) set.add(match[1]);
    });
    return Array.from(set).sort((a, b) => parseInt(a) - parseInt(b));
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({error: 'Method not allowed'});
    }

    try {
        // One JSON object per line. Avoid sudo — `admin` is in the docker group.
        const result = await executeHostCommand(
            `docker ps --format '{{json .}}'`
        );

        const containers: DockerContainer[] = result.stdout
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const obj = JSON.parse(line);
                return {
                    name: obj.Names || '',
                    image: obj.Image || '',
                    ports: parseContainerPorts(obj.Ports || ''),
                };
            })
            .filter(c => c.name)
            .sort((a, b) => a.name.localeCompare(b.name));

        res.status(200).json({status: 'success', data: containers});
    } catch (error) {
        res.status(500).json({
            error: 'Failed to list containers',
            details: error instanceof Error ? error.message : String(error),
        });
    }
}

export default authMiddleware(handler);
