import { createRestClient, createRestTxOperations } from '@hcengineering/api-client';
import tracker from '@hcengineering/tracker';
import { randomUUID } from 'crypto';

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHRyYSI6e30sImFjY291bnQiOiI5YzljZjk0NS0xNmQ5LTRmYzEtOWMxOS04OWMxZDNjODZjNWYiLCJ3b3Jrc3BhY2UiOiI1ZjVhNjFjZS0xN2NkLTQ2NDctYTU4My1jMTllYmQ2NjFiNjIifQ.7AloqvyecQuR-toWatRqeYCPnThOMspPr59sqHWDsiA';
const WS = '5f5a61ce-17cd-4647-a583-c19ebd661b62';
const TRANSACTOR = 'ws://localhost:3332';

const CORE_SPACE_SPACE = 'core:space:Space' as any;
const GITHUB_BR_CLASS = 'github:class:GithubBranchRequest' as any;
const TRACKER_IDS_NO_PARENT = 'tracker:ids:NoParent' as any;

async function run() {
  const readClient = createRestClient(TRANSACTOR, WS, TOKEN);
  const ops = await createRestTxOperations(TRANSACTOR, WS, TOKEN);

  // Check or create TECH_ project
  let techProject = (await readClient.findAll(tracker.class.Project, { identifier: 'TECH_' } as any))[0] as any;

  if (!techProject) {
    console.log('📂 TECH_ project not found, creating...');
    const projectId = randomUUID().replace(/-/g, '') as any;
    await ops.createDoc(
      tracker.class.Project,
      CORE_SPACE_SPACE,
      {
        identifier: 'TECH_',
        name: 'Tech Issues (test)',
        description: '',
        private: false,
        members: ['9c9cf945-16d9-4fc1-9c19-89c1d3c86c5f' as any],
        owners: ['9c9cf945-16d9-4fc1-9c19-89c1d3c86c5f' as any],
        sequence: 0,
        defaultTimeReportDay: 'PreviousWorkDay' as any,
        autoJoin: false,
        color: 5,
        icon: 'tracker:icon:Home' as any,
        archived: false,
        type: 'tracker:ids:ClassingProjectType' as any,
        useClientName: true,
      } as any,
      projectId
    );
    techProject = (await readClient.findAll(tracker.class.Project, { identifier: 'TECH_' } as any))[0] as any;
    if (!techProject) {
      console.log('❌ Failed to create TECH_ project');
      return;
    }
    console.log(`✅ TECH_ project created: ${techProject._id}`);
  } else {
    console.log(`✅ Found TECH_ project: ${techProject._id} - ${techProject.name}`);
  }

  // Get a valid status from any project
  const allStatuses = await readClient.findAll('tracker:class:IssueStatus' as any, {} as any);
  const status = (allStatuses[0] as any)?._id ?? 'tracker:status:Backlog';
  console.log(`📌 Using status: ${status}`);

  // Create test issue with clientName in TECH_ project
  const issueId = randomUUID().replace(/-/g, '') as any;
  const testRepo = 'huly-3f'; // repo name for clientName

  console.log(`\n🔨 Creating test issue in TECH_ project with clientName="${testRepo}"...`);
  await ops.addCollection(
    tracker.class.Issue,
    techProject._id,
    TRACKER_IDS_NO_PARENT,
    tracker.class.Issue,
    'subIssues',
    {
      title: 'test-branch-auto',
      description: '',
      status: status,
      priority: 0,
      number: 8888,
      rank: '0|z',
      comments: 0,
      subIssues: 0,
      dueDate: null,
      parents: [],
      reportedTime: 0,
      remainingTime: 0,
      estimation: 0,
      childInfo: [],
      relations: [],
      clientName: testRepo,
    } as any,
    issueId
  );

  console.log(`✅ Issue created: ${issueId}`);

  // Wait for trigger to process
  console.log('\n⏳ Waiting 5s for trigger to process...');
  await new Promise(r => setTimeout(r, 5000));

  // Check if GithubBranchRequest was created
  const branchRequests = await readClient.findAll(GITHUB_BR_CLASS, { issueId: issueId as any } as any);
  console.log(`\n🔍 GithubBranchRequests for issue: ${branchRequests.length}`);
  if (branchRequests.length > 0) {
    branchRequests.forEach((br: any) => {
      console.log(`  ✅ action=${br.action} status=${br.status} repo=${br.repo} branch=${br.branchName}`);
    });
  } else {
    console.log('  ❌ No GithubBranchRequest created');
    console.log('     (check transactor logs for OnTechIssueChange trigger errors)');
  }

  // Also list all pending requests
  const allPending = await readClient.findAll(GITHUB_BR_CLASS, { status: 'pending' } as any);
  console.log(`\n📋 All pending GithubBranchRequests: ${allPending.length}`);
  allPending.forEach((br: any) => {
    console.log(`  - issueId=${br.issueId} action=${br.action} repo=${br.repo} branch=${br.branchName}`);
  });
}

run().catch(console.error);
