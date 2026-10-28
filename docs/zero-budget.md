# Running Relay with a $0 cloud budget

Use the complete local Docker application. Two API replicas, Redis coordination, PostgreSQL persistence, and Nginx are real running services on your computer, not simulated API responses.

```bash
docker compose up -d --build
```

On Windows with Docker Desktop's Linux context:

```powershell
docker --context desktop-linux compose up -d --build
```

Open `http://127.0.0.1:8080`. Existing volumes are preserved. To stop the app without deleting data, use `docker compose stop`; do not use `down -v` unless you deliberately want to erase its database.

Cloud deployments are disabled by default in all four AWS workflows. Keep repository variable `AWS_DEPLOYMENT_ENABLED` unset or `false`. No AWS credentials are needed for local operation. The AWS worker profile and S3 attachments are optional and remain off without configured AWS resources.

This is not an AWS deployment or public hosting. CloudWatch/SNS, S3 attachment round trips, and SQS worker/DLQ behavior remain unverified in AWS. The Terraform and release workflow source is retained for a future paid deployment. Before opting in, configure account access locally, choose a region and validated origin domain/certificate, protect the Terraform state backend and GitHub environments, and approve possible charges. See [deployment](deployment.md).

The workflow switch is not a billing cap and does not stop pre-existing cloud resources or prevent a manual Terraform apply. AWS credits/free-tier coverage are not assumed. Local operation also consumes your computer's resources; "$0" here means no newly provisioned AWS resources or AWS deployment charges from this work.

See [verification](verification.md) for actual test and performance results. Run load generators separately from builds/tests. Passing a local connection/fan-out probe does not establish production AWS capacity or a sustained throughput SLO.
