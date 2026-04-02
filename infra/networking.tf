# --- Security Group ---
resource "aws_security_group" "bot" {
  name        = "${var.project_name}-sg"
  description = "SSH from admin IP only"

  # SSH from your IP
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
    description = "SSH from admin"
  }

  # All outbound (Telegram polling, CoinGecko, KBS, CafeF, VnExpress, LLM APIs)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-sg" }
}

# --- Elastic IP (free when attached to running instance) ---
resource "aws_eip" "bot" {
  domain = "vpc"
  tags   = { Name = "${var.project_name}-eip" }
}

resource "aws_eip_association" "bot" {
  instance_id   = aws_instance.bot.id
  allocation_id = aws_eip.bot.id
}
