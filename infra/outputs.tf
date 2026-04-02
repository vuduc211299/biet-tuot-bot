output "ec2_public_ip" {
  description = "Elastic IP of the EC2 instance → use as EC2_HOST in GitHub Secrets"
  value       = aws_eip.bot.public_ip
}

output "ecr_repository_url" {
  description = "ECR repository URL → referenced by GitHub Actions"
  value       = aws_ecr_repository.bot.repository_url
}

output "deployer_access_key_id" {
  description = "AWS_ACCESS_KEY_ID for GitHub Actions secret"
  value       = aws_iam_access_key.deployer.id
}

output "deployer_secret_access_key" {
  description = "AWS_SECRET_ACCESS_KEY for GitHub Actions secret (sensitive)"
  value       = aws_iam_access_key.deployer.secret
  sensitive   = true
}
