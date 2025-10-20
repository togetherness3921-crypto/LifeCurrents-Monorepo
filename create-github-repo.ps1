# PowerShell script to create GitHub repository and push monorepo
# Usage: .\create-github-repo.ps1 -Token "your_github_token" -RepoName "LifeCurrents-Monorepo"

param(
    [Parameter(Mandatory=$true)]
    [string]$Token,
    
    [Parameter(Mandatory=$false)]
    [string]$RepoName = "LifeCurrents-Monorepo",
    
    [Parameter(Mandatory=$false)]
    [string]$Description = "Unified monorepo for LifeCurrents frontend and worker",
    
    [Parameter(Mandatory=$false)]
    [bool]$IsPrivate = $false
)

Write-Host "🚀 Creating GitHub repository: $RepoName" -ForegroundColor Cyan

# Create repository using GitHub API
$headers = @{
    "Authorization" = "Bearer $Token"
    "Accept" = "application/vnd.github.v3+json"
}

$body = @{
    "name" = $RepoName
    "description" = $Description
    "private" = $IsPrivate
    "auto_init" = $false
} | ConvertTo-Json

try {
    Write-Host "📡 Calling GitHub API..." -ForegroundColor Yellow
    $response = Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post -Headers $headers -Body $body -ContentType "application/json"
    
    Write-Host "✅ Repository created successfully!" -ForegroundColor Green
    Write-Host "   URL: $($response.html_url)" -ForegroundColor White
    Write-Host "   Clone URL: $($response.clone_url)" -ForegroundColor White
    
    # Add remote and push
    Write-Host "`n📤 Adding remote and pushing code..." -ForegroundColor Cyan
    
    # Remove origin if it exists
    git remote remove origin 2>$null
    
    # Add new origin
    git remote add origin $response.clone_url
    Write-Host "✅ Remote 'origin' added" -ForegroundColor Green
    
    # Push to main branch
    Write-Host "📤 Pushing to main branch..." -ForegroundColor Yellow
    git push -u origin main
    
    Write-Host "`n✅ SUCCESS! Repository created and code pushed!" -ForegroundColor Green
    Write-Host "`n🔗 Repository URL: $($response.html_url)" -ForegroundColor Cyan
    Write-Host "`n📋 Next Steps:" -ForegroundColor Yellow
    Write-Host "   1. Configure Cloudflare Pages (see MIGRATION_GUIDE.md)" -ForegroundColor White
    Write-Host "   2. Update worker deployment if needed" -ForegroundColor White
    Write-Host "   3. Test the deployed application" -ForegroundColor White
    
} catch {
    Write-Host "❌ Error creating repository:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $reader.BaseStream.Position = 0
        $reader.DiscardBufferedData()
        $responseBody = $reader.ReadToEnd()
        Write-Host "API Response: $responseBody" -ForegroundColor Red
    }
    
    exit 1
}

