// This file is designed to be modified by the CI/CD pipeline.
// The placeholders below will be replaced with actual values during the build process.

const GITHUB_TOKEN = '__VITE_GITHUB_TOKEN__';
const REPO_OWNER = '__VITE_GITHUB_REPO_OWNER__';
const REPO_NAME = '__VITE_GITHUB_REPO_NAME__';

const API_BASE_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

/**
 * Merges a pull request.
 * @param prNumber The number of the pull request to merge.
 * @returns The result of the merge operation.
 */
export const mergePullRequest = async (prNumber: number) => {
  if (GITHUB_TOKEN.startsWith('__VITE_')) {
    console.error('GitHub token has not been replaced by CI/CD pipeline.');
    throw new Error('Missing GitHub credentials.');
  }

  const response = await fetch(`${API_BASE_URL}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({
      commit_title: `Merge PR #${prNumber} from preview`,
      commit_message: 'Merged via LifeCurrents UI',
      merge_method: 'squash', // Or 'merge', 'rebase'
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to merge PR #${prNumber}: ${errorData.message}`);
  }

  return response.json();
};
