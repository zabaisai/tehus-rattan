// Deployed-version identity, injected at image-build time via build args →
// container env (see Dockerfile). Never invented: when unset (local dev), the
// values are the literal 'unknown' so nothing false is reported.
//
//  - RELEASE_SHA:  the exact git commit the image was built from.
//  - BUILD_TIME:   ISO timestamp of the build.
//
// This is safe to log and to expose in a minimal /health/version response — a
// commit SHA and timestamp are not secrets.
export const RELEASE_INFO = {
  sha: process.env.RELEASE_SHA?.trim() || 'unknown',
  builtAt: process.env.BUILD_TIME?.trim() || 'unknown',
} as const;
