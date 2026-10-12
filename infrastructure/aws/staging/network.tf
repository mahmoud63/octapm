# Dedicated staging VPC (never the default VPC): two public subnets for the ALB
# and the Fargate tasks, two private subnets for RDS. No NAT gateway: the tasks
# take public IPs for outbound calls (ECR, Secrets Manager, CloudWatch, SES,
# Anthropic) and accept inbound traffic only from the ALB's security group.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = {
    Name      = "${var.name}-vpc"
    Component = "network"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags = {
    Name      = "${var.name}-igw"
    Component = "network"
  }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  map_public_ip_on_launch = false
  tags = {
    Name      = "${var.name}-public-${local.azs[count.index]}"
    Component = "network"
    Tier      = "public"
  }
}

resource "aws_subnet" "database" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 10 + count.index)
  tags = {
    Name      = "${var.name}-db-${local.azs[count.index]}"
    Component = "network"
    Tier      = "database"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = {
    Name      = "${var.name}-public-rt"
    Component = "network"
  }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# The database subnets have only the VPC-local route: no internet in or out.
resource "aws_route_table" "database" {
  vpc_id = aws_vpc.main.id
  tags = {
    Name      = "${var.name}-db-rt"
    Component = "network"
  }
}

resource "aws_route_table_association" "database" {
  count          = 2
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database.id
}

# S3 gateway endpoint (free): the tasks reach the uploads bucket inside AWS.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
  tags = {
    Name      = "${var.name}-s3-endpoint"
    Component = "network"
  }
}
