export type EnvVarPolicy = "inherit_all" | "inherit_none" | "inherit_core_only" | "exclude_sensitive";

const SENSITIVE_PATTERNS: RegExp[] = [
  /_API_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /_PASSWORD$/i,
  /_CREDENTIAL$/i,
  /^API_KEY$/i,
  /^SECRET$/i,
  /^TOKEN$/i,
  /^PASSWORD$/i,
  /^AWS_SECRET_ACCESS_KEY$/i,
  /^AWS_SESSION_TOKEN$/i,
  /^DATABASE_URL$/i,
];

const ALWAYS_INCLUDE = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "TERM",
  "TMPDIR",
  "LC_ALL",
  "LC_CTYPE",
  // Language-specific paths
  "GOPATH",
  "GOROOT",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "NVM_DIR",
  "NODE_PATH",
  "PYTHON_PATH",
  "PYTHONPATH",
  "VIRTUAL_ENV",
  "CONDA_PREFIX",
  "JAVA_HOME",
  "GRADLE_HOME",
  "MAVEN_HOME",
  "RUBY_HOME",
  "GEM_HOME",
  "GEM_PATH",
  // Build/development
  "EDITOR",
  "VISUAL",
  "PAGER",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
]);

function isSensitive(key: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

export function filterEnvironmentVariables(
  env: Record<string, string | undefined>,
  policy: EnvVarPolicy = "exclude_sensitive",
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const key of Object.keys(env)) {
    const value = env[key];
    if (value === undefined) continue;

    switch (policy) {
      case "inherit_all":
        result[key] = value;
        break;
      case "inherit_none":
        break;
      case "inherit_core_only":
        if (ALWAYS_INCLUDE.has(key)) {
          result[key] = value;
        }
        break;
      case "exclude_sensitive":
        if (ALWAYS_INCLUDE.has(key) || !isSensitive(key)) {
          result[key] = value;
        }
        break;
    }
  }

  return result;
}
