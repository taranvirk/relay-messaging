# ARN-resolution context for IAM Policy Autopilot only.
# The approved demo is provisioned through AWS MCP; do not terraform apply this.
resource "aws_ecr_repository" "demo_api" {
  name = "relay-demo-api"
}

resource "aws_ecr_repository" "demo_web" {
  name = "relay-demo-web"
}
