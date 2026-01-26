# PowerShell Script to Set Local Environment Variables
# Sets environment variables for the current PowerShell session and optionally persists them

param(
    [switch]$Persist,  # If set, variables persist across sessions (user-level)
    [switch]$SkipRedis,
    [switch]$SkipMailchimp,
    [switch]$SkipAWS
)

$ErrorActionPreference = "Stop"

Write-Host "=== Setting Local Environment Variables ===" -ForegroundColor Cyan
Write-Host ""

# Function to set environment variable
function Set-EnvironmentVariable {
    param(
        [string]$Name,
        [string]$Value,
        [string]$Description
    )
    
    Write-Host "Setting $Name..." -ForegroundColor Yellow
    
    # Set for current session
    [Environment]::SetEnvironmentVariable($Name, $Value, [EnvironmentVariableTarget]::Process)
    
    # Set for user if persist flag is used
    if ($Persist) {
        [Environment]::SetEnvironmentVariable($Name, $Value, [EnvironmentVariableTarget]::User)
        Write-Host "  ✓ Set for current session and persisted to user environment" -ForegroundColor Green
    } else {
        Write-Host "  ✓ Set for current session only (use -Persist to save permanently)" -ForegroundColor Green
    }
}

# Redis Configuration
if (-not $SkipRedis) {
    Write-Host "`n--- Redis Configuration ---" -ForegroundColor Cyan
    $redisUrl = Read-Host "Enter Redis API URL (e.g., http://localhost:3000/api)"
    if ($redisUrl) {
        Set-EnvironmentVariable -Name "REDIS_API_URL" -Value $redisUrl -Description "Redis API endpoint"
    }
    
    $redisPassword = Read-Host "Enter Redis Password (optional)" -AsSecureString
    if ($redisPassword) {
        $redisPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($redisPassword)
        )
        Set-EnvironmentVariable -Name "REDIS_PASSWORD" -Value $redisPasswordPlain -Description "Redis password"
    }
}

# Mailchimp Configuration
if (-not $SkipMailchimp) {
    Write-Host "`n--- Mailchimp Configuration ---" -ForegroundColor Cyan
    $mailchimpApiKey = Read-Host "Enter Mailchimp API Key (optional)"
    if ($mailchimpApiKey) {
        Set-EnvironmentVariable -Name "MAILCHIMP_API_KEY" -Value $mailchimpApiKey -Description "Mailchimp API key"
    }
    
    $mailchimpListId = Read-Host "Enter Mailchimp List ID (optional)"
    if ($mailchimpListId) {
        Set-EnvironmentVariable -Name "MAILCHIMP_LIST_ID" -Value $mailchimpListId -Description "Mailchimp list ID"
    }
}

# AWS Configuration
if (-not $SkipAWS) {
    Write-Host "`n--- AWS Configuration ---" -ForegroundColor Cyan
    $awsRegion = Read-Host "Enter AWS Region (default: us-east-1)"
    if ([string]::IsNullOrEmpty($awsRegion)) { $awsRegion = "us-east-1" }
    Set-EnvironmentVariable -Name "AWS_REGION" -Value $awsRegion -Description "AWS region"
    
    $awsAccessKeyId = Read-Host "Enter AWS Access Key ID (optional)"
    if ($awsAccessKeyId) {
        Set-EnvironmentVariable -Name "AWS_ACCESS_KEY_ID" -Value $awsAccessKeyId -Description "AWS access key ID"
    }
    
    $awsSecretAccessKey = Read-Host "Enter AWS Secret Access Key (optional)" -AsSecureString
    if ($awsSecretAccessKey) {
        $awsSecretPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($awsSecretAccessKey)
        )
        Set-EnvironmentVariable -Name "AWS_SECRET_ACCESS_KEY" -Value $awsSecretPlain -Description "AWS secret access key"
    }
    
    $ec2Host = Read-Host "Enter EC2 Host (optional)"
    if ($ec2Host) {
        Set-EnvironmentVariable -Name "EC2_HOST" -Value $ec2Host -Description "EC2 instance host"
    }
    
    $ec2User = Read-Host "Enter EC2 User (default: ec2-user)"
    if ([string]::IsNullOrEmpty($ec2User)) { $ec2User = "ec2-user" }
    Set-EnvironmentVariable -Name "EC2_USER" -Value $ec2User -Description "EC2 SSH user"
    
    $ec2SshKeyPath = Read-Host "Enter EC2 SSH Key Path (optional)"
    if ($ec2SshKeyPath) {
        Set-EnvironmentVariable -Name "EC2_SSH_KEY_PATH" -Value $ec2SshKeyPath -Description "EC2 SSH key file path"
    }
}

# GitHub/GitLab Configuration
Write-Host "`n--- Git Configuration ---" -ForegroundColor Cyan
$githubToken = Read-Host "Enter GitHub Personal Access Token (optional)" -AsSecureString
if ($githubToken) {
    $githubTokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($githubToken)
    )
    Set-EnvironmentVariable -Name "GITHUB_TOKEN" -Value $githubTokenPlain -Description "GitHub personal access token"
}

$gitlabToken = Read-Host "Enter GitLab Personal Access Token (optional)" -AsSecureString
if ($gitlabToken) {
    $gitlabTokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($gitlabToken)
    )
    Set-EnvironmentVariable -Name "GITLAB_TOKEN" -Value $gitlabTokenPlain -Description "GitLab personal access token"
}

# Blog Authoring GUI Configuration
Write-Host "`n--- Blog Authoring GUI Configuration ---" -ForegroundColor Cyan
$blogAuthUsername = Read-Host "Enter Blog Authoring GUI Username (optional)"
if ($blogAuthUsername) {
    Set-EnvironmentVariable -Name "BLOG_AUTH_USERNAME" -Value $blogAuthUsername -Description "Blog authoring GUI username"
}

$blogAuthPassword = Read-Host "Enter Blog Authoring GUI Password (optional)" -AsSecureString
if ($blogAuthPassword) {
    $blogAuthPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($blogAuthPassword)
    )
    Set-EnvironmentVariable -Name "BLOG_AUTH_PASSWORD" -Value $blogAuthPasswordPlain -Description "Blog authoring GUI password"
}

Write-Host ""
Write-Host "=== Environment Variables Set Successfully! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Variables are set for this PowerShell session." -ForegroundColor Yellow
if ($Persist) {
    Write-Host "Variables have been persisted to your user environment." -ForegroundColor Yellow
    Write-Host "They will be available in future PowerShell sessions." -ForegroundColor Yellow
} else {
    Write-Host "To persist variables across sessions, run this script with -Persist flag:" -ForegroundColor Yellow
    Write-Host "  .\scripts\set-env-variables.ps1 -Persist" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "To verify variables, run:" -ForegroundColor Yellow
Write-Host "  Get-ChildItem Env: | Where-Object { `$_.Name -like '*REDIS*' -or `$_.Name -like '*MAILCHIMP*' -or `$_.Name -like '*AWS*' }" -ForegroundColor Cyan
