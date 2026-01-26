# PowerShell Setup Script for Portfolio Site
# Automates installation and verification of all dependencies

param(
    [switch]$SkipGit,
    [switch]$SkipAWS,
    [switch]$SkipRedis,
    [string]$ProjectPath = "portfolio-app"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Portfolio Site Setup Script ===" -ForegroundColor Cyan
Write-Host ""

# Function to check if command exists
function Test-Command {
    param([string]$Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

# Function to check and install Node.js
function Install-NodeJS {
    Write-Host "Checking Node.js installation..." -ForegroundColor Yellow
    if (Test-Command "node") {
        $nodeVersion = node --version
        Write-Host "Node.js already installed: $nodeVersion" -ForegroundColor Green
    } else {
        Write-Host "Node.js not found. Please install Node.js LTS from https://nodejs.org/" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Checking npm installation..." -ForegroundColor Yellow
    if (Test-Command "npm") {
        $npmVersion = npm --version
        Write-Host "npm already installed: $npmVersion" -ForegroundColor Green
    } else {
        Write-Host "npm not found." -ForegroundColor Red
        exit 1
    }
}

# Function to check and install Angular CLI
function Install-AngularCLI {
    Write-Host "Checking Angular CLI installation..." -ForegroundColor Yellow
    if (Test-Command "ng") {
        try {
            # Try to get version with --json flag (Angular CLI 12+)
            $ngVersionOutput = ng version --json 2>&1
            if ($LASTEXITCODE -eq 0) {
                $ngVersion = $ngVersionOutput | ConvertFrom-Json | Select-Object -ExpandProperty Angular -ErrorAction SilentlyContinue
                if ($ngVersion) {
                    Write-Host "Angular CLI already installed: $ngVersion" -ForegroundColor Green
                } else {
                    # Fallback: try without --json
                    $ngVersion = ng version 2>&1 | Select-String -Pattern "Angular CLI:\s*(\d+\.\d+\.\d+)" | ForEach-Object { $_.Matches.Groups[1].Value }
                    if ($ngVersion) {
                        Write-Host "Angular CLI already installed: $ngVersion" -ForegroundColor Green
                    } else {
                        Write-Host "Angular CLI already installed" -ForegroundColor Green
                    }
                }
            } else {
                # Fallback: just check if ng command works
                Write-Host "Angular CLI already installed" -ForegroundColor Green
            }
        } catch {
            Write-Host "Angular CLI already installed" -ForegroundColor Green
        }
    } else {
        Write-Host "Installing Angular CLI globally..." -ForegroundColor Yellow
        npm install -g @angular/cli
        Write-Host "Angular CLI installed successfully" -ForegroundColor Green
    }
}

# Function to check AWS CLI
function Install-AWSCLI {
    if ($SkipAWS) {
        Write-Host "Skipping AWS CLI installation..." -ForegroundColor Yellow
        return
    }
    
    Write-Host "Checking AWS CLI installation..." -ForegroundColor Yellow
    if (Test-Command "aws") {
        $awsVersion = aws --version
        Write-Host "AWS CLI already installed: $awsVersion" -ForegroundColor Green
    } else {
        Write-Host "AWS CLI not found. Please install from https://aws.amazon.com/cli/" -ForegroundColor Yellow
    }
}

# Function to check GitHub CLI
function Install-GitHubCLI {
    if ($SkipGit) {
        Write-Host "Skipping GitHub CLI installation..." -ForegroundColor Yellow
        return
    }
    
    Write-Host "Checking GitHub CLI installation..." -ForegroundColor Yellow
    if (Test-Command "gh") {
        try {
            $ghVersion = gh --version 2>&1 | Select-Object -First 1
            Write-Host "GitHub CLI already installed: $ghVersion" -ForegroundColor Green
        } catch {
            Write-Host "GitHub CLI already installed" -ForegroundColor Green
        }
    } else {
        Write-Host "GitHub CLI not found. Attempting to install..." -ForegroundColor Yellow
        try {
            winget install --id GitHub.cli --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
            if (Test-Command "gh") {
                Write-Host "GitHub CLI installed successfully" -ForegroundColor Green
            } else {
                Write-Host "GitHub CLI installation may require manual setup. Skipping..." -ForegroundColor Yellow
            }
        } catch {
            Write-Host "Could not install GitHub CLI automatically. Please install manually from https://cli.github.com/" -ForegroundColor Yellow
        }
    }
}

# Function to check GitLab CLI
function Install-GitLabCLI {
    if ($SkipGit) {
        Write-Host "Skipping GitLab CLI installation..." -ForegroundColor Yellow
        return
    }
    
    Write-Host "Checking GitLab CLI installation..." -ForegroundColor Yellow
    if (Test-Command "glab") {
        try {
            $glabVersion = glab --version 2>&1 | Select-Object -First 1
            Write-Host "GitLab CLI already installed: $glabVersion" -ForegroundColor Green
        } catch {
            Write-Host "GitLab CLI already installed" -ForegroundColor Green
        }
    } else {
        Write-Host "GitLab CLI not found. Attempting to install..." -ForegroundColor Yellow
        try {
            winget install --id GitLab.GitLabCLI --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
            if (Test-Command "glab") {
                Write-Host "GitLab CLI installed successfully" -ForegroundColor Green
            } else {
                Write-Host "GitLab CLI installation may require manual setup. Skipping..." -ForegroundColor Yellow
                Write-Host "  Install manually: https://gitlab.com/gitlab-org/cli#installation" -ForegroundColor Gray
            }
        } catch {
            Write-Host "Could not install GitLab CLI automatically. Skipping..." -ForegroundColor Yellow
            Write-Host "  Install manually: https://gitlab.com/gitlab-org/cli#installation" -ForegroundColor Gray
        }
    }
}

# Function to install project dependencies
function Install-ProjectDependencies {
    Write-Host "Installing project dependencies..." -ForegroundColor Yellow
    
    # Get the script directory and check for project
    $scriptDir = Split-Path -Parent $PSCommandPath
    $rootDir = Split-Path -Parent $scriptDir
    $projectFullPath = Join-Path $rootDir $ProjectPath
    
    if (Test-Path $projectFullPath) {
        Write-Host "Installing dependencies for $ProjectPath..." -ForegroundColor Cyan
        Push-Location $projectFullPath
        try {
            npm install
            Write-Host "$ProjectPath dependencies installed successfully" -ForegroundColor Green
        } catch {
            Write-Host "Error installing dependencies for $ProjectPath`: $($_.Exception.Message)" -ForegroundColor Red
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "Project directory not found: $projectFullPath" -ForegroundColor Yellow
        Write-Host "Skipping dependency installation for $ProjectPath" -ForegroundColor Yellow
    }
    
    # Also install dependencies for blog-authoring-gui if it exists
    $blogGuiPath = Join-Path $rootDir "blog-authoring-gui"
    if (Test-Path $blogGuiPath) {
        Write-Host "Installing dependencies for blog-authoring-gui..." -ForegroundColor Cyan
        Push-Location $blogGuiPath
        try {
            npm install
            Write-Host "blog-authoring-gui dependencies installed successfully" -ForegroundColor Green
        } catch {
            Write-Host "Error installing dependencies for blog-authoring-gui`: $($_.Exception.Message)" -ForegroundColor Red
        } finally {
            Pop-Location
        }
    }
    
    # Also install dependencies for redis-api-server if it exists
    $redisApiPath = Join-Path $rootDir "redis-api-server"
    if (Test-Path $redisApiPath) {
        Write-Host "Installing dependencies for redis-api-server..." -ForegroundColor Cyan
        Push-Location $redisApiPath
        try {
            npm install
            Write-Host "redis-api-server dependencies installed successfully" -ForegroundColor Green
        } catch {
            Write-Host "Error installing dependencies for redis-api-server`: $($_.Exception.Message)" -ForegroundColor Red
        } finally {
            Pop-Location
        }
    }
}

# Function to backup existing codebase
function Backup-Codebase {
    $backupPath = "portfolio-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    if (Test-Path $ProjectPath) {
        Write-Host "Backing up existing codebase to $backupPath..." -ForegroundColor Yellow
        Copy-Item -Path $ProjectPath -Destination $backupPath -Recurse
        Write-Host "Backup completed successfully" -ForegroundColor Green
    }
}

# Main execution
try {
    Install-NodeJS
    Install-AngularCLI
    Install-AWSCLI
    Install-GitHubCLI
    Install-GitLabCLI
    Backup-Codebase
    Install-ProjectDependencies
    
    Write-Host ""
    Write-Host "=== Setup completed successfully! ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Configure Redis API Server:" -ForegroundColor White
    Write-Host "   cd redis-api-server" -ForegroundColor Gray
    Write-Host "   .\setup.ps1" -ForegroundColor Gray
    Write-Host "   npm start" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. Configure environment variables in portfolio-app/src/environments/" -ForegroundColor White
    Write-Host "3. Set up Redis connection details in redis-api-server/.env" -ForegroundColor White
    Write-Host "4. Configure AWS credentials (optional)" -ForegroundColor White
    Write-Host "5. Run portfolio app: cd portfolio-app && npm start" -ForegroundColor White
    Write-Host "6. Run blog authoring GUI: cd blog-authoring-gui && npm start" -ForegroundColor White
    
} catch {
    Write-Host "Error during setup`: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
