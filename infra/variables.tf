variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-southeast-1"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "biettuotbot"
}

variable "instance_type" {
  description = "EC2 instance type (t3.micro = free tier in ap-southeast-1)"
  type        = string
  default     = "t3.micro"
}

variable "key_pair_name" {
  description = "Name of the SSH key pair (create in AWS Console first)"
  type        = string
}

variable "my_ip" {
  description = "Your public IP in CIDR notation (e.g. 113.190.x.x/32). Find with: curl ifconfig.me"
  type        = string
}
