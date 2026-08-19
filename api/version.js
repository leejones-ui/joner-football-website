// Deploy verification: proves which git commit is serving production so the
// dashboard and the independent verifier can detect out-of-git deployments.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({
    service: 'joner-football-website',
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    repo: process.env.VERCEL_GIT_REPO_SLUG ? `${process.env.VERCEL_GIT_REPO_OWNER || ''}/${process.env.VERCEL_GIT_REPO_SLUG}` : null,
    deployed_url: process.env.VERCEL_URL || null,
    timestamp: new Date().toISOString(),
  })
}
