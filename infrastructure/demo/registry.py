"""Verify the demo image manifests and pull rights, then start the deployment.

Runs only on the EC2 host with its instance role. Never prints registry tokens.
Explicit repository names also permit deterministic IAM policy generation.
"""

import base64
import json
import os
import subprocess
import tempfile

import boto3


def preflight(ecr, tag):
    manifests = [
        (
            "relay-demo-api",
            ecr.batch_get_image(
                repositoryName="relay-demo-api", imageIds=[{"imageTag": tag}]
            ),
        ),
        (
            "relay-demo-web",
            ecr.batch_get_image(
                repositoryName="relay-demo-web", imageIds=[{"imageTag": tag}]
            ),
        ),
    ]
    for repository, response in manifests:
        if response.get("failures") or not response.get("images"):
            raise RuntimeError("Demo image manifest is unavailable: " + repository)
        manifest = json.loads(response["images"][0]["imageManifest"])
        digest = manifest["layers"][0]["digest"]
        if repository == "relay-demo-api":
            layers = ecr.batch_check_layer_availability(
                repositoryName="relay-demo-api", layerDigests=[digest]
            )
            ecr.get_download_url_for_layer(
                repositoryName="relay-demo-api", layerDigest=digest
            )
        else:
            layers = ecr.batch_check_layer_availability(
                repositoryName="relay-demo-web", layerDigests=[digest]
            )
            ecr.get_download_url_for_layer(
                repositoryName="relay-demo-web", layerDigest=digest
            )
        if layers.get("failures"):
            raise RuntimeError("Demo image layer is unavailable: " + repository)


def main():
    ecr = boto3.client("ecr", region_name="us-east-2")
    preflight(ecr, os.environ["RELAY_IMAGE_TAG"])
    authorization = ecr.get_authorization_token()["authorizationData"][0]
    username, password = base64.b64decode(
        authorization["authorizationToken"]
    ).decode().split(":", 1)
    with tempfile.TemporaryDirectory(prefix="relay-registry-", dir="/run") as config:
        environment = dict(os.environ, DOCKER_CONFIG=config)
        subprocess.run(
            [
                "docker", "login", "--username", username, "--password-stdin",
                authorization["proxyEndpoint"],
            ],
            input=password, text=True, check=True, env=environment,
            stdout=subprocess.DEVNULL,
        )
        subprocess.run(
            ["docker", "compose", "-f", "/opt/relay/compose.yaml", "pull"],
            check=True, env=environment, cwd="/opt/relay",
        )
    # Keep the one-shot migration outside Compose's long-running health wait.
    # Explicit stages also avoid the proxy starting before its API DNS names.
    stages = [
        ["up", "-d", "--wait", "--wait-timeout", "240", "postgres", "redis"],
        ["run", "--rm", "--no-deps", "migrate"],
        ["up", "-d", "--no-deps", "--wait", "--wait-timeout", "240",
         "backend", "backend-replica"],
        ["up", "-d", "--no-deps", "--wait", "--wait-timeout", "120", "frontend"],
        ["up", "-d", "--no-deps", "--wait", "--wait-timeout", "120", "gateway"],
    ]
    for stage in stages:
        subprocess.run(
            ["docker", "compose", "-f", "/opt/relay/compose.yaml"] + stage,
            check=True, cwd="/opt/relay",
        )
    print("Relay containers started; registry credentials removed from /run.")


if __name__ == "__main__":
    main()
