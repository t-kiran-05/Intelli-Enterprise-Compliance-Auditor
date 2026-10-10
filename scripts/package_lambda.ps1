<#
.SYNOPSIS
    Packages the AWS Lambda function for deployment.
.DESCRIPTION
    Builds Linux-compatible Python 3.11 dependencies using pip for manylinux2014_x86_64,
    assembles Lambda source files (index.py, audit_core.py, checklists.json),
    and creates lambda_function.zip in the terraform/ directory.
#>

[CmdletBinding()]
param(
    [string]$Architecture = "x86_64",
    [string]$PythonVersion = "3.11",
    [string]$OutputDir = "terraform",
    [switch]$SkipDeps
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$LambdaSrc = Join-Path $ProjectRoot "terraform\lambda_src"
$BuildDir = Join-Path $ProjectRoot "deployment_package"
$ZipTarget = Join-Path $ProjectRoot "$OutputDir\lambda_function.zip"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Packaging AWS Lambda Function" -ForegroundColor Cyan
Write-Host "Architecture:   $Architecture" -ForegroundColor DarkCyan
Write-Host "Python Version: $PythonVersion" -ForegroundColor DarkCyan
Write-Host "Source:         $LambdaSrc" -ForegroundColor DarkCyan
Write-Host "Output Zip:     $ZipTarget" -ForegroundColor DarkCyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Clean previous build directory
if (Test-Path $BuildDir) {
    Write-Host "Cleaning existing build directory: $BuildDir..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $BuildDir
}
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

# 2. Pinned dependencies
$Dependencies = @(
    "google-genai==2.28.0",
    "pypdf==6.19.0",
    "pydantic==2.13.5"
)

if (-not $SkipDeps) {
    Write-Host "`n[1/3] Installing manylinux dependencies to $BuildDir..." -ForegroundColor Green
    $Platform = "manylinux2014_$Architecture"

    foreach ($dep in $Dependencies) {
        Write-Host "  -> Installing $dep for $Platform..." -ForegroundColor Gray
        pip install `
            --platform $Platform `
            --only-binary=:all: `
            --python-version $PythonVersion `
            --implementation cp `
            --target $BuildDir `
            --upgrade `
            $dep
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to install $dep for $Platform"
        }
    }

    # Clean cache and unnecessary metadata to keep package slim
    Write-Host "Cleaning __pycache__ and dist-info..." -ForegroundColor Gray
    Get-ChildItem -Path $BuildDir -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
    Get-ChildItem -Path $BuildDir -Recurse -Directory -Filter "*.dist-info" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
} else {
    Write-Host "`n[1/3] Skipping dependency install (-SkipDeps requested)..." -ForegroundColor Yellow
}

# 3. Copy source files
Write-Host "`n[2/3] Copying Lambda source files..." -ForegroundColor Green
$SourceFiles = @("index.py", "audit_core.py", "checklists.json", "gemini_limiter.py")
foreach ($file in $SourceFiles) {
    $srcPath = Join-Path $LambdaSrc $file
    if (-not (Test-Path $srcPath)) {
        Write-Error "Required source file missing: $srcPath"
    }
    Copy-Item -Path $srcPath -Destination $BuildDir -Force
    Write-Host "  -> Bundled $file" -ForegroundColor Gray
}

# 4. Create ZIP
Write-Host "`n[3/3] Compressing into $ZipTarget..." -ForegroundColor Green
if (Test-Path $ZipTarget) {
    Remove-Item -Force $ZipTarget
}

$TargetParent = Split-Path -Parent $ZipTarget
if (-not (Test-Path $TargetParent)) {
    New-Item -ItemType Directory -Force -Path $TargetParent | Out-Null
}

Compress-Archive -Path "$BuildDir\*" -DestinationPath $ZipTarget -Force

$ZipSizeMb = (Get-Item $ZipTarget).Length / 1MB
Write-Host "`nSuccessfully created $ZipTarget ($([math]::Round($ZipSizeMb, 2)) MB)" -ForegroundColor Cyan
Write-Host "Ready for terraform apply or direct AWS Lambda upload." -ForegroundColor Green

