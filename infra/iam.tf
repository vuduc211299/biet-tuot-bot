# =============================================================
# IAM User for GitHub Actions (push images to ECR)
# =============================================================
resource "aws_iam_user" "deployer" {
  name = "${var.project_name}-deployer"
}

resource "aws_iam_access_key" "deployer" {
  user = aws_iam_user.deployer.name
}

resource "aws_iam_user_policy" "deployer_ecr" {
  name = "${var.project_name}-ecr-push"
  user = aws_iam_user.deployer.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
        ]
        Resource = aws_ecr_repository.bot.arn
      }
    ]
  })
}

# =============================================================
# IAM Role for EC2 (pull images from ECR — no credentials on instance)
# =============================================================
resource "aws_iam_role" "ec2_bot" {
  name = "${var.project_name}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ec2.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "ec2_ecr_pull" {
  name = "${var.project_name}-ecr-pull"
  role = aws_iam_role.ec2_bot.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
        ]
        Resource = aws_ecr_repository.bot.arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ec2_bot" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2_bot.name
}
