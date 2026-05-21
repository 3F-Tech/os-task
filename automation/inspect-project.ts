import { createRestClient } from '@hcengineering/api-client';
import tracker from '@hcengineering/tracker';

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHRyYSI6e30sImFjY291bnQiOiI5YzljZjk0NS0xNmQ5LTRmYzEtOWMxOS04OWMxZDNjODZjNWYiLCJ3b3Jrc3BhY2UiOiI1ZjVhNjFjZS0xN2NkLTQ2NDctYTU4My1jMTllYmQ2NjFiNjIifQ.7AloqvyecQuR-toWatRqeYCPnThOMspPr59sqHWDsiA';
const WS = '5f5a61ce-17cd-4647-a583-c19ebd661b62';

async function run() {
  const client = createRestClient('ws://localhost:3332', WS, TOKEN);
  const projects = await client.findAll(tracker.class.Project, {});
  console.log('Projects:', projects.length);
  if (projects[0]) {
    const p = projects[0] as any;
    console.log(JSON.stringify(p, null, 2));
  }
}
run().catch(console.error);
