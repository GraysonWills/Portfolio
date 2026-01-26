# Redis API Server Setup Script
# This script helps configure the Redis API server

Write-Host "Redis API Server Setup" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (Test-Path ".env") {
    Write-Host "Found existing .env file" -ForegroundColor Yellow
    $overwrite = Read-Host "Do you want to overwrite it? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "Setup cancelled." -ForegroundColor Yellow
        exit 0
    }
}

# Get Redis Cloud credentials
Write-Host "`nRedis Cloud Database Configuration:" -ForegroundColor Green
Write-Host "Connecting to Redis Cloud (not local Redis)" -ForegroundColor Cyan
$redisEndpoint = Read-Host "Redis Cloud Endpoint (e.g., redis-15545.c14.us-east-1-2.ec2.cloud.redislabs.com:15545)"

if ($redisEndpoint -match "^(.+):(\d+)$") {
    $redisHost = $matches[1]
    $redisPort = $matches[2]
} else {
    $redisHost = $redisEndpoint
    $redisPort = Read-Host "Redis Cloud Port (default: 15545)"
    if ([string]::IsNullOrWhiteSpace($redisPort)) {
        $redisPort = "15545"
    }
}

$redisPassword = Read-Host "Redis Cloud Database Password" -AsSecureString
$redisPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($redisPassword)
)

# Auto-detect TLS for Redis Cloud (port 15545 typically requires TLS)
if ($redisPort -eq "15545" -or $redisPort -eq 15545) {
    $redisTls = "true"
    Write-Host "TLS automatically enabled for Redis Cloud port 15545" -ForegroundColor Green
} else {
    $redisTlsInput = Read-Host "Use TLS? (Y/n - Recommended for Redis Cloud)"
    if ([string]::IsNullOrWhiteSpace($redisTlsInput) -or $redisTlsInput -eq "y" -or $redisTlsInput -eq "Y") {
        $redisTls = "true"
    } else {
        $redisTls = "false"
        Write-Host "Warning: TLS is recommended for Redis Cloud connections" -ForegroundColor Yellow
    }
}

$serverPort = Read-Host "API Server Port (default: 3000)"
if ([string]::IsNullOrWhiteSpace($serverPort)) {
    $serverPort = "3000"
}

# Redis Cloud API keys (for management operations)
Write-Host "`nRedis Cloud API Keys (Optional - for admin/monitoring operations):" -ForegroundColor Yellow
Write-Host "Note: These are separate from your database password. API keys are for" -ForegroundColor Gray
Write-Host "      management operations (viewing database info, status, logs)." -ForegroundColor Gray
Write-Host "      You still need the database password for data operations." -ForegroundColor Gray
$useApiKeys = Read-Host "`nDo you want to configure Redis Cloud API keys? (y/N)"
$apiAccountKey = ""
$apiUserKey = ""

if ($useApiKeys -eq "y" -or $useApiKeys -eq "Y") {
    Write-Host "`nEnter your Redis Cloud API credentials:" -ForegroundColor Cyan
    $apiAccountKey = Read-Host "Redis Cloud Account Key (x-api-key)"
    if ([string]::IsNullOrWhiteSpace($apiAccountKey)) {
        Write-Host "Account key cannot be empty. Skipping API key configuration." -ForegroundColor Yellow
        $useApiKeys = "n"
    } else {
        $apiUserKeySecure = Read-Host "Redis Cloud User Key (x-api-secret-key)" -AsSecureString
        $apiUserKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiUserKeySecure)
        )
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiUserKeySecure)
        )
        
        if ([string]::IsNullOrWhiteSpace($apiUserKey)) {
            Write-Host "User key cannot be empty. Skipping API key configuration." -ForegroundColor Yellow
            $useApiKeys = "n"
            $apiAccountKey = ""
        } else {
            Write-Host "[OK] API keys configured" -ForegroundColor Green
        }
    }
}

# Create .env file
$envContent = "# Redis Configuration`n"
$envContent += "REDIS_HOST=$redisHost`n"
$envContent += "REDIS_PORT=$redisPort`n"
$envContent += "REDIS_PASSWORD=$redisPasswordPlain`n"
$envContent += "REDIS_TLS=$redisTls`n"
$envContent += "REDIS_DB=0`n"
$envContent += "`n"
$envContent += "# Server Configuration`n"
$envContent += "PORT=$serverPort`n"
$envContent += "NODE_ENV=development`n"
$envContent += "`n"
$envContent += "# Redis Cloud REST API (Optional - for management operations only)`n"
$envContent += "# These are NOT used for data operations, only for admin tasks`n"

# Add API keys if configured
$shouldAddApiKeys = ($useApiKeys -eq "y" -or $useApiKeys -eq "Y")
$hasAccountKey = -not [string]::IsNullOrWhiteSpace($apiAccountKey)
$hasUserKey = -not [string]::IsNullOrWhiteSpace($apiUserKey)

if ($shouldAddApiKeys -and $hasAccountKey -and $hasUserKey) {
    $envContent += "REDIS_CLOUD_ACCOUNT_KEY=$apiAccountKey`n"
    $envContent += "REDIS_CLOUD_USER_KEY=$apiUserKey`n"
}

$envContent | Out-File -FilePath ".env" -Encoding UTF8 -NoNewline

Write-Host ""
Write-Host "[OK] Configuration saved to .env" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Run: npm install" -ForegroundColor White
Write-Host "2. Run: npm start" -ForegroundColor White
$apiUrl = "http://localhost:$serverPort/api"
Write-Host ""
Write-Host "The API will be available at: $apiUrl" -ForegroundColor Green

# Clean up secure string from memory
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($redisPassword)
)
