# PowerShell Script to Configure Windows Credential Manager
# Stores AWS, Redis, GitHub, and GitLab credentials securely

param(
    [switch]$AWS,
    [switch]$Redis,
    [switch]$GitHub,
    [switch]$GitLab,
    [switch]$All
)

# Install CredentialManager module if not present
if (-not (Get-Module -ListAvailable -Name CredentialManager)) {
    Write-Host "Installing CredentialManager module..." -ForegroundColor Yellow
    Install-Module -Name CredentialManager -Force -Scope CurrentUser
}

# Function to store AWS credentials
function Set-AWSCredentials {
    Write-Host "Configuring AWS credentials..." -ForegroundColor Yellow
    $accessKeyId = Read-Host "Enter AWS Access Key ID"
    $secretAccessKey = Read-Host "Enter AWS Secret Access Key" -AsSecureString
    $region = Read-Host "Enter AWS Region (default: us-east-1)"
    if ([string]::IsNullOrEmpty($region)) { $region = "us-east-1" }
    
    $credential = New-Object System.Management.Automation.PSCredential($accessKeyId, $secretAccessKey)
    Set-StoredCredential -Target "portfolio-aws-access-key" -Credential $credential
    
    $regionCredential = New-Object System.Management.Automation.PSCredential("region", (ConvertTo-SecureString $region -AsPlainText -Force))
    Set-StoredCredential -Target "portfolio-aws-region" -Credential $regionCredential
    
    Write-Host "AWS credentials stored successfully" -ForegroundColor Green
}

# Function to store Redis credentials
function Set-RedisCredentials {
    Write-Host "Configuring Redis credentials..." -ForegroundColor Yellow
    $redisUrl = Read-Host "Enter Redis API URL"
    $redisPassword = Read-Host "Enter Redis Password" -AsSecureString
    
    $urlCredential = New-Object System.Management.Automation.PSCredential("url", (ConvertTo-SecureString $redisUrl -AsPlainText -Force))
    Set-StoredCredential -Target "portfolio-redis-url" -Credential $urlCredential
    
    $passwordCredential = New-Object System.Management.Automation.PSCredential("password", $redisPassword)
    Set-StoredCredential -Target "portfolio-redis-password" -Credential $passwordCredential
    
    Write-Host "Redis credentials stored successfully" -ForegroundColor Green
}

# Function to store GitHub credentials
function Set-GitHubCredentials {
    Write-Host "Configuring GitHub credentials..." -ForegroundColor Yellow
    $token = Read-Host "Enter GitHub Personal Access Token" -AsSecureString
    
    $credential = New-Object System.Management.Automation.PSCredential("token", $token)
    Set-StoredCredential -Target "portfolio-github-token" -Credential $credential
    
    Write-Host "GitHub credentials stored successfully" -ForegroundColor Green
}

# Function to store GitLab credentials
function Set-GitLabCredentials {
    Write-Host "Configuring GitLab credentials..." -ForegroundColor Yellow
    $token = Read-Host "Enter GitLab Personal Access Token" -AsSecureString
    
    $credential = New-Object System.Management.Automation.PSCredential("token", $token)
    Set-StoredCredential -Target "portfolio-gitlab-token" -Credential $credential
    
    Write-Host "GitLab credentials stored successfully" -ForegroundColor Green
}

# Main execution
try {
    if ($All) {
        Set-AWSCredentials
        Set-RedisCredentials
        Set-GitHubCredentials
        Set-GitLabCredentials
    } else {
        if ($AWS) { Set-AWSCredentials }
        if ($Redis) { Set-RedisCredentials }
        if ($GitHub) { Set-GitHubCredentials }
        if ($GitLab) { Set-GitLabCredentials }
        
        if (-not $AWS -and -not $Redis -and -not $GitHub -and -not $GitLab) {
            Write-Host "No option selected. Use -All to configure all credentials or specify individual options." -ForegroundColor Yellow
            Write-Host "Usage: .\configure-credentials.ps1 -All" -ForegroundColor Cyan
        }
    }
    
    Write-Host ""
    Write-Host "=== Credential configuration completed! ===" -ForegroundColor Green
    
} catch {
    Write-Host "Error during credential configuration: $_" -ForegroundColor Red
    exit 1
}
