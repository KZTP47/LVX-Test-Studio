'use strict';
const nodes=[
  {
    "id": "security-scan",
    "name": "Security Scan",
    "category": "Security",
    "icon": "shield"
  },
  {
    "id": "security-gate",
    "name": "Security Gate",
    "category": "Security",
    "icon": "shield"
  },
  {
    "id": "git-repo",
    "name": "Git Repo",
    "category": "Integrations",
    "icon": "branch"
  },
  {
    "id": "unit-test-runner",
    "name": "Unit Test",
    "category": "Integrations",
    "icon": "test"
  },
  {
    "id": "ai-unit-test",
    "name": "AI Unit Test",
    "category": "Integrations",
    "icon": "robot"
  },
  {
    "id": "ai-log-summary",
    "name": "AI Log Summary",
    "category": "Integrations",
    "icon": "file"
  },
  {
    "id": "log-collector",
    "name": "Log Collector & Zip",
    "category": "Integrations",
    "icon": "archive"
  },
  {
    "id": "start-runner",
    "name": "Start Runner",
    "category": "Integrations",
    "icon": "play"
  },
  {
    "id": "wait-delay",
    "name": "Wait / Delay",
    "category": "Integrations",
    "icon": "clock"
  },
  {
    "id": "api-performance",
    "name": "API Performance",
    "category": "Automation",
    "icon": "activity"
  },
  {
    "id": "api-contract",
    "name": "API Contract",
    "category": "Automation",
    "icon": "code"
  },
  {
    "id": "code-review",
    "name": "AI Code Review",
    "category": "Automation",
    "icon": "eye"
  },
  {
    "id": "website-ux-auto-tester",
    "name": "Website UX Auto Tester",
    "category": "Automation",
    "icon": "globe"
  },
  {
    "id": "push-deploy",
    "name": "Push & Deploy",
    "category": "Automation",
    "icon": "upload"
  }
];
const aliases={'api-test':'api-performance','contract-test':'api-contract',deployment:'push-deploy',test:'test-suite',suite:'test-suite',job:'test-suite'};
function normalizeType(type){const value=String(type||'test-suite').replace(/_/g,'-');return aliases[value]||value;}
function getNode(type){return nodes.find(node=>node.id===normalizeType(type));}
module.exports={schemaVersion:1,nodes:Object.freeze(nodes.map(Object.freeze)),normalizeType,getNode};
