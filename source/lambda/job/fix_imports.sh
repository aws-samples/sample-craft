#!/bin/bash

# Find all Python files
find . -name "*.py" | while read file; do
  # Replace llm_bot_dep imports with local imports
  sed -i 's/from llm_bot_dep\./from /g' "$file"
  sed -i 's/import llm_bot_dep\./import /g' "$file"
  sed -i 's/from llm_bot_dep /from /g' "$file"
done

echo "Import paths updated successfully"