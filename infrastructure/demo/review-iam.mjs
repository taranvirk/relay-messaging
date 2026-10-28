// Review IAM Policy Autopilot output, never infer IAM actions from source.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const generated = JSON.parse(readFileSync(0, 'utf8'));
if (generated.Policies?.length !== 1) throw new Error('Expected one generated policy.');
const policy = structuredClone(generated.Policies[0].Policy);
const permitted = new Set([
  'ecr:BatchCheckLayerAvailability',
  'ecr:BatchGetImage',
  'ecr:GetDownloadUrlForLayer',
  'ecr:GetAuthorizationToken',
]);
// Autopilot includes conditional permissions for pull-through-cache misses.
// This demo has ordinary pre-pushed repositories, not pull-through caches.
const excludedCacheOperations = new Set([
  'ecr:BatchImportUpstreamImage',
  'ecr:CreateRepository',
  'ecr:TagResource',
]);
const expectedRepositories = [
  'arn:aws:ecr:us-east-2:806079021406:repository/relay-demo-api',
  'arn:aws:ecr:us-east-2:806079021406:repository/relay-demo-web',
];
for (const statement of policy.Statement) {
  if (statement.Effect !== 'Allow') throw new Error('Unexpected policy effect.');
  for (const action of statement.Action) {
    if (!permitted.has(action) && !excludedCacheOperations.has(action)) {
      throw new Error('Unexpected generated permission: ' + action);
    }
  }
  statement.Action = statement.Action.filter((action) => permitted.has(action));
  const tokenOnly = statement.Action.every((action) => action === 'ecr:GetAuthorizationToken');
  const expected = tokenOnly ? ['*'] : expectedRepositories;
  if (JSON.stringify([...statement.Resource].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error('Generated resource scope differs from approved demo repositories.');
  }
}
policy.Statement = policy.Statement.filter((statement) => statement.Action.length);
writeFileSync(join(directory, 'iam-generated.json'), JSON.stringify(generated, null, 2) + '\n');
writeFileSync(join(directory, 'iam-reviewed.json'), JSON.stringify(policy, null, 2) + '\n');
console.log(
  JSON.stringify({ policy, excludedConditionalCacheActions: [...excludedCacheOperations] }),
);
