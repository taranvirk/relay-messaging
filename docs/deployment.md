# AWS deployment

## Deployment is opt-in

Cloud jobs are disabled unless the **repository-level** GitHub variable `AWS_DEPLOYMENT_ENABLED` is exactly `true`. This gates Terraform plan/apply and application releases; ordinary local/CI tests still run. Keep it unset or `false` for a $0 cloud budget. Do not enable it until account access, target region/domain, protected environments, and spending authority are confirmed.

This is a workflow safeguard, not an AWS billing cap: running Terraform manually bypasses it, and it does not stop or remove pre-existing cloud resources. Fargate usage and NAT gateways can incur charges; free-tier eligibility or credits are not assumed. Review [Fargate pricing](https://aws.amazon.com/fargate/pricing/), [VPC pricing](https://aws.amazon.com/vpc/pricing/) and [AWS Budgets limitations](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) before opting in. A $0 budget is supported by running the complete Docker Compose application locally, not by claiming this infrastructure is free to run on AWS.

## Prerequisites

- AWS account and a Terraform state S3 bucket with DynamoDB locking
- Terraform 1.9.5+, AWS CLI, Docker, Node 24+
- GitHub OIDC provider and narrowly scoped plan/apply/deploy roles
- A confirmed SNS email subscription for alerts
- An origin hostname (for example `api-origin.example.com`) and a DNS-validated ACM certificate for that name in the chosen AWS region. Point the hostname to the ALB output after apply.

Terraform state contains generated secrets: encrypt it, block public access, enable versioning/locking, and restrict IAM access. Review costs before applying: NAT, ALB, ECS, multi-AZ RDS, and Redis are paid resources. No resources have been provisioned in your account by this build.

Copy the relevant `backend.hcl.example` to ignored `backend.hcl`, then:

```bash
cd infrastructure/terraform
terraform init -backend-config=environments/dev/backend.hcl
terraform plan -var environment=dev \
  -var origin_domain_name=api-origin.example.com \
  -var origin_certificate_arn=arn:aws:acm:REGION:ACCOUNT:certificate/ID -out=tfplan
terraform apply tfplan
```

Terraform creates secrets rather than accepting database, Redis, or JWT values in source. RDS and Redis have no public addressability; ECS reaches them through security-group references in private subnets.

## First application release

1. Read the Terraform outputs for ECR, ECS, frontend bucket, CloudFront, and application URL.
2. Build and push `backend/Dockerfile` to the ECR repository.
3. Run Prisma migrations as a one-off ECS task using the same task definition/network. Migrations must complete before the API deployment.
4. Force a new ECS service deployment and wait for healthy ALB targets.
5. Build the frontend with `VITE_API_URL=""`, sync `frontend/dist` to the frontend bucket, and invalidate CloudFront.
6. Check `/api/health/ready`, then open two real sessions and test a WebSocket send.

The initial task definition references `backend_image_tag` (default `latest`); tasks cannot become healthy before that image exists. First push a chosen tag and supply the variable, or run the backend deployment workflow after infrastructure creation. Do not seed demo users in production.

## GitHub configuration

Repository/environment variables:

- Repository-level `AWS_DEPLOYMENT_ENABLED` (leave unset/false until deployment is approved)
- `AWS_REGION`
- `ECR_REPOSITORY`
- `ECS_CLUSTER`, `ECS_SERVICE`, `ECS_TASK_FAMILY`
- `ECS_WORKER_TASK_FAMILY`
- `APPLICATION_URL`
- `FRONTEND_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`
- `TF_STATE_BUCKET`, `TF_LOCK_TABLE`, `ORIGIN_DOMAIN_NAME`, `ORIGIN_CERTIFICATE_ARN`, `ALARM_EMAIL`

Environment secrets contain only OIDC role ARNs: `AWS_DEPLOY_ROLE_ARN`, `AWS_TERRAFORM_PLAN_ROLE_ARN`, and `AWS_TERRAFORM_APPLY_ROLE_ARN`. No long-lived AWS keys are needed.

Protect `production`, `production-infrastructure`, and `infrastructure-plan` GitHub Environments with reviewers. Scope OIDC trust to the repository/environment. Deploy workflows run the reusable complete CI checks before obtaining deployment credentials. Backend deployment runs a one-off ECS migration, verifies its exit code, and then rolls the API and matching worker. The deploy role needs scoped ECS RunTask/RegisterTaskDefinition/UpdateService, IAM PassRole, ECR, S3, and CloudFront access. Plan runs only for same-repository PRs; do not grant cloud credentials to untrusted fork code.

## WebSocket validation

CloudFront forwards `/socket.io/*` without caching, including cookies, query strings, and WebSocket headers. ALB uses HTTP/1.1 upgrades, a 120-second idle timeout, and target draining. Relay uses WebSocket-only transport to avoid polling affinity. The Redis adapter alone would NOT remove polling's need for stickiness. REST is the UI fallback.

## Domain and TLS

The viewer uses CloudFront's managed certificate/domain. Application and attachment CORS automatically use that URL. The ALB origin requires a regional ACM certificate, HTTPS-only forwarding, CloudFront's managed network prefix, and a generated verification header. SPA rewrites affect static requests only; API 403s remain JSON 403s.

Optional custom viewer hostnames require an ACM certificate in `us-east-1`, CloudFront aliases/viewer certificate changes, DNS, and `frontend_origin`; this customization is not automated. See [AWS origin restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html) and [Socket.IO scaling constraints](https://socket.io/docs/v4/using-multiple-nodes/).
