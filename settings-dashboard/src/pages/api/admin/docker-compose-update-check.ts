import { NextApiRequest, NextApiResponse } from 'next'
import { authMiddleware } from "@/backend/auth/middleware";
import { execute } from "@/backend/cmd/executor";
import { getConfig } from "@/configuration/getConfigBackend";

interface UpdateInfo {
  image: string;
  currentDigest: string;
  availableDigest: string;
}

const mock = getConfig("MOCK") === "true";

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if(mock) {
    return res.status(200).json({
      "updatesAvailable": true,
      "images": [
        {
          "image": "nginx:latest",
          "currentDigest": "local-not-found",
          "availableDigest": "sha256:088eea90c3d0a540ee5686e7d7471acbd4063b6e97eaf49b5e651665eb7f4dc7"
        }
      ]
    });
  }

  const composePath = getConfig("COMPOSE_FOLDER_PATH");

  try {
    const cdCommand = `cd ${composePath}`;

    // Get list of current images
    const { stdout: localImages } = await execute(
      `${cdCommand} && docker compose config --images`
    );

    // Check each image for updates
    const updates: UpdateInfo[] = [];
    for (const image of localImages.split('\n').filter(Boolean)) {
      try {
        // Get currently running container's image digest
        let currentDigest = "local-not-found";
        try {
          // Find container ID using the image name
          const { stdout: containerIds } = await execute(
            `${cdCommand} && docker compose ps -q | xargs docker inspect -f '{{if eq .Config.Image "${image}"}}{{.Id}}{{end}}'`
          );

          // Get first non-empty container ID
          const containerId = containerIds
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)[0];

          if (containerId) {
            // Get image digest from the running container
            const { stdout: containerImageId } = await execute(
              `docker inspect --format '{{.Image}}' ${containerId.trim()}`
            );
            currentDigest = containerImageId.trim();
          }
        } catch (error) {
          console.warn(`Warning: Couldn't get digest for running container of ${image}: ${error.message}`);
        }

        // Pull the latest image to get its digest
        await execute(`docker pull ${image} --quiet`);
        const { stdout: latestDigest } = await execute(
          `docker image inspect ${image} --format '{{.Id}}'`
        );
        const availableDigest = latestDigest.trim();

        // Compare digests
        if (currentDigest !== availableDigest) {
          updates.push({
            image,
            currentDigest,
            availableDigest
          });
        }
      } catch (error) {
        console.error(`Error processing image ${image}: ${error.message}`);
        updates.push({
          image,
          currentDigest: "local-not-found",
          availableDigest: "remote-not-found"
        });
      }
    }

    res.status(200).json({
      updatesAvailable: updates.length > 0,
      images: updates
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to check for updates',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

export default authMiddleware(handler);