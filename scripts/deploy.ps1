# PowerShell Deployment Script for Portfolio Site
# Deploys the application to AWS EC2

param(
    [Parameter(Mandatory=$true)]
    [string]$Environment = "production",
    
    [Parameter(Mandatory=$false)]
    [string]$EC2Host = "",
    
    [Parameter(Mandatory=$false)]
    [string]$EC2User = "ec2-user",
    
    [Parameter(Mandatory=$false)]
    [string]$SSHKeyPath = "",
    
    [switch]$SkipBuild,
    [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"
$ProjectPath = "portfolio-app"

Write-Host "=== Portfolio Site Deployment Script ===" -ForegroundColor Cyan
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host ""

# Function to get credentials from Windows Credential Manager
function Get-CredentialFromVault {
    param([string]$Target)
    try {
        $cred = Get-StoredCredential -Target $Target -ErrorAction SilentlyContinue
        return $cred
    } catch {
        Write-Host "Credential not found in vault for: $Target" -ForegroundColor Yellow
        return $null
    }
}

# Function to build the application
function Build-Application {
    if ($SkipBuild) {
        Write-Host "Skipping build..." -ForegroundColor Yellow
        return
    }
    
    Write-Host "Building application..." -ForegroundColor Yellow
    Set-Location $ProjectPath
    
    # Set environment variables
    $env:REDIS_API_URL = if ($Environment -eq "production") { $env:REDIS_API_URL_PROD } else { $env:REDIS_API_URL_DEV }
    $env:MAILCHIMP_API_KEY = if ($Environment -eq "production") { $env:MAILCHIMP_API_KEY_PROD } else { $env:MAILCHIMP_API_KEY_DEV }
    
    npm run build -- --configuration=$Environment
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Build completed successfully" -ForegroundColor Green
    Set-Location ..
}

# Function to backup on EC2
function Backup-EC2 {
    param([string]$Host, [string]$User, [string]$KeyPath)
    
    if ($SkipBackup) {
        Write-Host "Skipping EC2 backup..." -ForegroundColor Yellow
        return
    }
    
    Write-Host "Creating backup on EC2..." -ForegroundColor Yellow
    $backupTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $sshCommand = "ssh -i `"$KeyPath`" $User@$Host 'sudo mv /var/www/portfolio-app /var/www/portfolio-app.backup-$backupTimestamp || true'"
    Invoke-Expression $sshCommand
    
    Write-Host "Backup completed" -ForegroundColor Green
}

# Function to deploy to EC2
function Deploy-ToEC2 {
    param([string]$Host, [string]$User, [string]$KeyPath)
    
    Write-Host "Deploying to EC2 ($Host)..." -ForegroundColor Yellow
    
    # Create deployment directory
    $sshCommand = "ssh -i `"$KeyPath`" $User@$Host 'sudo mkdir -p /var/www/portfolio-app && sudo chown -R $User:$User /var/www/portfolio-app'"
    Invoke-Expression $sshCommand
    
    # Copy files
    $distPath = Join-Path $ProjectPath "dist\portfolio-app\*"
    $scpCommand = "scp -i `"$KeyPath`" -r $distPath $User@${Host}:/var/www/portfolio-app/"
    Invoke-Expression $scpCommand
    
    # Restart nginx
    $restartCommand = "ssh -i `"$KeyPath`" $User@$Host 'sudo systemctl restart nginx'"
    Invoke-Expression $restartCommand
    
    Write-Host "Deployment completed successfully!" -ForegroundColor Green
}

# Main execution
try {
    # Get EC2 configuration from environment or parameters
    if ([string]::IsNullOrEmpty($EC2Host)) {
        $EC2Host = if ($Environment -eq "production") { $env:EC2_HOST_PROD } else { $env:EC2_HOST_DEV }
    }
    
    if ([string]::IsNullOrEmpty($SSHKeyPath)) {
        $SSHKeyPath = $env:EC2_SSH_KEY_PATH
    }
    
    if ([string]::IsNullOrEmpty($EC2Host) -or [string]::IsNullOrEmpty($SSHKeyPath)) {
        Write-Host "EC2 host and SSH key path are required!" -ForegroundColor Red
        Write-Host "Set EC2_HOST and EC2_SSH_KEY_PATH environment variables or pass as parameters" -ForegroundColor Yellow
        exit 1
    }
    
    Build-Application
    Backup-EC2 -Host $EC2Host -User $EC2User -KeyPath $SSHKeyPath
    Deploy-ToEC2 -Host $EC2Host -User $EC2User -KeyPath $SSHKeyPath
    
    Write-Host ""
    Write-Host "=== Deployment completed successfully! ===" -ForegroundColor Green
    
} catch {
    Write-Host "Error during deployment: $_" -ForegroundColor Red
    exit 1
}
