resource "aws_sns_topic" "alarms" { name = "${local.name}-alarms" }
resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals { alarm_actions = [aws_sns_topic.alarms.arn] }

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.name}-high-5xx"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions          = { LoadBalancer = aws_lb.api.arn_suffix }
  alarm_actions       = local.alarm_actions
}
resource "aws_cloudwatch_metric_alarm" "unhealthy_targets" {
  alarm_name          = "${local.name}-unhealthy-targets"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions          = { LoadBalancer = aws_lb.api.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
  alarm_actions       = local.alarm_actions
}
resource "aws_cloudwatch_metric_alarm" "ecs_cpu" {
  alarm_name          = "${local.name}-ecs-cpu"
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.backend.name }
  alarm_actions       = local.alarm_actions
}
resource "aws_cloudwatch_metric_alarm" "ecs_memory" {
  alarm_name          = "${local.name}-ecs-memory"
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.backend.name }
  alarm_actions       = local.alarm_actions
}
resource "aws_cloudwatch_metric_alarm" "ecs_running_tasks" {
  alarm_name          = "${local.name}-ecs-running-tasks"
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = var.backend_desired_count
  comparison_operator = "LessThanThreshold"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.backend.name }
  alarm_actions       = local.alarm_actions
}
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name}-rds-cpu"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.id }
  alarm_actions       = local.alarm_actions
}
resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${local.name}-rds-low-storage"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2147483648
  comparison_operator = "LessThanThreshold"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.id }
  alarm_actions       = local.alarm_actions
}
resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  count               = 2
  alarm_name          = "${local.name}-redis-cpu-${count.index + 1}"
  namespace           = "AWS/ElastiCache"
  metric_name         = "EngineCPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 75
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { CacheClusterId = "${aws_elasticache_replication_group.main.id}-${format("%03d", count.index + 1)}", CacheNodeId = "0001" }
  alarm_actions       = local.alarm_actions
}
resource "aws_cloudwatch_metric_alarm" "queue_backlog" {
  alarm_name          = "${local.name}-queue-backlog"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  dimensions          = { QueueName = aws_sqs_queue.jobs.name }
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name
  dashboard_body = jsonencode({
    widgets = [
      { type = "metric", x = 0, y = 0, width = 12, height = 6, properties = { title = "API health", region = var.aws_region, metrics = [["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.api.arn_suffix], [".", "TargetResponseTime", ".", "."], [".", "HTTPCode_Target_5XX_Count", ".", "."]], stat = "Average", period = 60 } },
      { type = "metric", x = 12, y = 0, width = 12, height = 6, properties = { title = "ECS resources", region = var.aws_region, metrics = [["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.backend.name], [".", "MemoryUtilization", ".", ".", ".", "."]], period = 300 } },
      { type = "metric", x = 0, y = 6, width = 12, height = 6, properties = { title = "PostgreSQL", region = var.aws_region, metrics = [["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", aws_db_instance.main.id], [".", "CPUUtilization", ".", "."], [".", "FreeStorageSpace", ".", "."]], period = 300 } },
      { type = "metric", x = 12, y = 6, width = 12, height = 6, properties = { title = "Redis and jobs", region = var.aws_region, metrics = [["AWS/ElastiCache", "CurrConnections", "CacheClusterId", "${aws_elasticache_replication_group.main.id}-001", "CacheNodeId", "0001"], ["AWS/ElastiCache", "CurrConnections", "CacheClusterId", "${aws_elasticache_replication_group.main.id}-002", "CacheNodeId", "0001"], ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.jobs.name]], period = 300 } },
      { type = "metric", x = 0, y = 12, width = 24, height = 6, properties = { title = "Real-time messaging", region = var.aws_region, metrics = [["Relay/Application", "WebSocketConnections", "Service", "relay-api", "Environment", "production"], [".", "MessagesProcessed", ".", ".", ".", "."], [".", "MessageFailures", ".", ".", ".", "."]], period = 60 } }
    ]
  })
}
