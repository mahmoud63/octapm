terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote, encrypted, versioned state with S3's native lock file. The bucket
  # comes from ../bootstrap. Credentials come from the environment
  # (AWS_PROFILE=octapm-staging), never from this file.
  backend "s3" {
    bucket       = "octapm-staging-tfstate-977476317319"
    key          = "staging/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region
  # The stack refuses to run against any account but OctaPM Staging.
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project     = "OctaPM"
      Environment = "Staging"
      ManagedBy   = "Terraform"
      Owner       = "OctaPM Platform"
      Repository  = "mahmoud63/octapm"
      Stack       = "infrastructure/aws/staging"
    }
  }
}
