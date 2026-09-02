export function defaultContractYaml(projectName = "app"): string {
  return `# Architecture contract — source of truth lives in Git.
# Guardian verifies changes against this file. It does not invent policy.
version: "1"

project:
  name: "${projectName}"
  type: "node"

architecture:
  required_paths:
    - src
  forbidden_paths:
    - src/legacy
    - tmp
    - generated/unapproved

dependencies:
  allowed: null
  forbidden:
    - eval
    - vm2

security:
  secrets:
    forbid_in_source: true
  dangerous_patterns:
    - hardcoded_credentials
    - dynamic_code_execution
    - unsafe_child_process
  ignore_paths:
    - tests/fixtures

boundaries: {}

quality:
  tests_required: true
  typecheck_required: true
  build_required: false

scan:
  ignore:
    - node_modules
    - dist
    - .git
    - coverage
    - tests/fixtures

merge:
  require:
    - architecture
    - dependencies
    - security
    - boundaries
    - tests
`;
}
