variable "project_name" {
  type    = string
  default = "relay"
}
variable "environment" {
  type    = string
  default = "dev"
}
variable "aws_region" {
  type    = string
  default = "us-east-1"
}
variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}
variable "backend_image_tag" {
  type    = string
  default = "latest"
}
variable "backend_desired_count" {
  type    = number
  default = 2
}
variable "worker_desired_count" {
  type    = number
  default = 1
}
variable "backend_cpu" {
  type    = number
  default = 512
}
variable "backend_memory" {
  type    = number
  default = 1024
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}
variable "frontend_origin" {
  type    = string
  default = ""
}
variable "origin_domain_name" {
  type        = string
  description = "DNS hostname pointing to the ALB and covered by origin_certificate_arn."
}
variable "origin_certificate_arn" {
  type        = string
  description = "Validated ACM certificate in aws_region for the ALB origin hostname."
}
variable "alarm_email" {
  type    = string
  default = ""
}

locals {
  name            = "${var.project_name}-${var.environment}"
  azs             = slice(data.aws_availability_zones.available.names, 0, 2)
  frontend_origin = var.frontend_origin != "" ? var.frontend_origin : "https://${aws_cloudfront_distribution.main.domain_name}"
}
