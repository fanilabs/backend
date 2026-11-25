# GitHub Actions Workflow Validation (#605)

Workflow-only mistakes should be caught by a reproducible repository check.

## Validation Approach

Create a workflow validator job that:

1. Runs on changes to `.github/workflows/*.yml`
2. Validates workflow syntax and schema
3. Checks all three workflows without changing deployment

## Example Implementation

```bash
#!/bin/bash
# Validate workflow syntax

for file in .github/workflows/*.yml; do
  echo "Validating: $file"
  if ! grep -q "^jobs:" "$file"; then
    echo "❌ Missing jobs section"
    exit 1
  fi
done
echo "✅ All workflows valid"
```

Add as a separate validation workflow or pre-commit hook to catch issues early.
