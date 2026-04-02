resource "aws_instance" "bot" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  key_name               = var.key_pair_name
  vpc_security_group_ids = [aws_security_group.bot.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2_bot.name

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  user_data = base64encode(<<-USERDATA
    #!/bin/bash
    set -euxo pipefail

    # ---- 1. Install Docker ----
    yum update -y
    yum install -y docker
    systemctl enable docker
    systemctl start docker
    usermod -aG docker ec2-user

    # ---- 2. Create 1 GB swap (crash prevention for 1 GB RAM) ----
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab

    # ---- 3. Create app directory for .env ----
    mkdir -p /home/ec2-user/biettuotbot
    chown ec2-user:ec2-user /home/ec2-user/biettuotbot

    # ---- 4. ECR credential helper (auto-login via instance profile) ----
    yum install -y amazon-ecr-credential-helper
    mkdir -p /home/ec2-user/.docker
    cat > /home/ec2-user/.docker/config.json << 'EOF'
    {
      "credHelpers": {
        "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com": "ecr-login"
      }
    }
    EOF
    chown -R ec2-user:ec2-user /home/ec2-user/.docker
  USERDATA
  )

  tags = { Name = var.project_name }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}
