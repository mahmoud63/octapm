# Private, encrypted, single-AZ PostgreSQL for staging. Production Multi-AZ is
# a later decision. The CA is pinned: the backend image must be built with
# RDS_CA_CN="Amazon RDS us-east-1 Root CA RSA2048 G1" for this instance.

resource "aws_db_subnet_group" "main" {
  name       = "${var.name}-db"
  subnet_ids = aws_subnet.database[*].id
  tags = {
    Component = "database"
  }
}

resource "random_password" "db" {
  length  = 40
  special = false
}

resource "aws_db_instance" "main" {
  identifier     = "${var.name}-db"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = 0
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "octapm"
  username = "octapm_admin"
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  backup_retention_period    = 7
  backup_window              = "07:00-07:30"
  maintenance_window         = "sun:08:00-sun:08:30"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-db-final"

  performance_insights_enabled = false
  monitoring_interval          = 0

  tags = {
    Name      = "${var.name}-db"
    Component = "database"
  }
}
