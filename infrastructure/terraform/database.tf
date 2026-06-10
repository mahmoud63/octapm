################################
# RDS Subnet Group (needs 2+ AZs)
################################
resource "aws_db_subnet_group" "main" {
  name       = "${var.app_name}-db-subnet-group"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]

  tags = { Name = "${var.app_name}-db-subnet-group" }
}

resource "random_id" "db_final_snapshot_suffix" {
  byte_length = 4

  keepers = {
    app_name    = var.app_name
    environment = var.environment
    db_name     = var.db_name
  }
}

################################
# RDS PostgreSQL — db.t3.micro single-AZ
################################
resource "aws_db_instance" "main" {
  identifier = "${var.app_name}-db"

  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t3.micro"

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  allocated_storage     = 20
  max_allocated_storage = 50
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az            = false # single-AZ limits availability, but backups remain mandatory
  publicly_accessible = false

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.app_name}-${var.environment}-db-final-${random_id.db_final_snapshot_suffix.hex}"
  delete_automated_backups  = false
  copy_tags_to_snapshot     = true

  backup_retention_period = var.rds_backup_retention_days
  backup_window           = var.rds_backup_window
  maintenance_window      = "sun:04:00-sun:05:00"

  performance_insights_enabled = false # extra cost; enable when budget allows

  lifecycle {
    precondition {
      condition     = var.rds_backup_retention_days >= 7
      error_message = "F-007 production blocker: rds_backup_retention_days must be at least 7."
    }
  }

  tags = {
    Name                = "${var.app_name}-db"
    Environment         = var.environment
    BackupRetentionDays = tostring(var.rds_backup_retention_days)
    RPOHours            = tostring(var.rds_recovery_rpo_hours)
    RTOHours            = tostring(var.rds_recovery_rto_hours)
    ProductionBlocker   = "F-007"
  }
}
