#!/bin/bash
# Bash script to create GitHub repository and push monorepo
# Usage: ./create-github-repo.sh YOUR_GITHUB_TOKEN [REPO_NAME]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get parameters
GITHUB_TOKEN="$1"
REPO_NAME="${2:-LifeCurrents-Monorepo}"
DESCRIPTION="Unified monorepo for LifeCurrents frontend and worker"
IS_PRIVATE=false

if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}❌ Error: GitHub token is required${NC}"
    echo "Usage: $0 YOUR_GITHUB_TOKEN [REPO_NAME]"
    echo "Example: $0 ghp_xxxxxxxxxxxx LifeCurrents-Monorepo"
    exit 1
fi

echo -e "${CYAN}🚀 Creating GitHub repository: $REPO_NAME${NC}"

# Create repository using GitHub API
echo -e "${YELLOW}📡 Calling GitHub API...${NC}"

RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    -d "{\"name\":\"$REPO_NAME\",\"description\":\"$DESCRIPTION\",\"private\":$IS_PRIVATE,\"auto_init\":false}" \
    https://api.github.com/user/repos)

# Check if repository was created successfully
if echo "$RESPONSE" | grep -q '"full_name"'; then
    echo -e "${GREEN}✅ Repository created successfully!${NC}"
    
    # Extract URLs
    HTML_URL=$(echo "$RESPONSE" | grep -o '"html_url": "[^"]*' | cut -d'"' -f4)
    CLONE_URL=$(echo "$RESPONSE" | grep -o '"clone_url": "[^"]*' | cut -d'"' -f4)
    
    echo -e "   URL: $HTML_URL"
    echo -e "   Clone URL: $CLONE_URL"
    
    # Add remote and push
    echo -e "\n${CYAN}📤 Adding remote and pushing code...${NC}"
    
    # Remove origin if it exists
    git remote remove origin 2>/dev/null || true
    
    # Add new origin
    git remote add origin "$CLONE_URL"
    echo -e "${GREEN}✅ Remote 'origin' added${NC}"
    
    # Push to main branch
    echo -e "${YELLOW}📤 Pushing to main branch...${NC}"
    git push -u origin main
    
    echo -e "\n${GREEN}✅ SUCCESS! Repository created and code pushed!${NC}"
    echo -e "\n${CYAN}🔗 Repository URL: $HTML_URL${NC}"
    echo -e "\n${YELLOW}📋 Next Steps:${NC}"
    echo -e "   1. Configure Cloudflare Pages (see MIGRATION_GUIDE.md)"
    echo -e "   2. Update worker deployment if needed"
    echo -e "   3. Test the deployed application"
    
else
    echo -e "${RED}❌ Error creating repository:${NC}"
    echo "$RESPONSE" | grep -o '"message": "[^"]*' | cut -d'"' -f4
    exit 1
fi

