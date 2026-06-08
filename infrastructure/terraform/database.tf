################################
# RDS Subnet Group (needs 2+ AZs)
################################
resource "aws_db_subnet_group" "main" {
  name       = "${var.app_name}-db-subnet-group"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]

  tags = { Name = "${var.app_name}-db-subnet-group" }
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

  multi_az               = false  # single-AZ to stay within $100/mo budget
  publicly_accessible    = false
  deletion_protection    = true
  skip_final_snapshot    = false
  final_snapshot_identifier = "${var.app_name}-db-final-snapshot"

  backup_retention_period = 0  # free tier allows 0 only
  backup_window           = "02:00-03:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  performance_insights_enabled = false  # extra cost; enable when budget allows

  tags = { Name = "${var.app_name}-db" }
}
