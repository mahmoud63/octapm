################################
# Key Pair
################################
resource "aws_key_pair" "main" {
  key_name   = "${var.app_name}-key"
  public_key = var.ssh_public_key
}

################################
# AMI — Latest Amazon Linux 2023 in me-south-1
################################
data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

################################
# EC2 Instance — t3.small
################################
resource "aws_instance" "app" {
  ami                    = data.aws_ami.amazon_linux_2023.id
  instance_type          = "t3.small"
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  key_name               = aws_key_pair.main.key_name
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    delete_on_termination = true
    encrypted             = true
  }

  user_data = base64encode(templatefile("${path.module}/templates/user-data.sh", {
    app_name   = var.app_name
    aws_region = var.aws_region
    db_host    = aws_db_instance.main.address
    db_name    = var.db_name
    db_user    = var.db_username
    s3_uploads = aws_s3_bucket.uploads.bucket
    secret_arn = aws_secretsmanager_secret.app.arn
  }))

  tags = { Name = "${var.app_name}-app" }

  depends_on = [aws_db_instance.main]
}

################################
# Elastic IP
################################
resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"

  tags = { Name = "${var.app_name}-eip" }
}
