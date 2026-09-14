import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir:'./tests/chat',outputDir:'test-results/chat',fullyParallel:false,workers:1,timeout:30000,
  reporter:[['list'],['json',{outputFile:'test-results/chat-report.json'}]],
  use:{baseURL:'http://localhost:4174',trace:'retain-on-failure'},
  projects:['chromium','firefox','webkit'].flatMap(browserName=>[{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}].map(size=>({name:`${browserName}-${size.name}`,use:{browserName:browserName as 'chromium'|'firefox'|'webkit',viewport:{width:size.width,height:size.height}}}))),
  webServer:[
    {command:'node --import tsx apps/api/test/e2e-server.ts',url:'http://localhost:3000/api/health',reuseExistingServer:false},
    {command:'npm run start -w @support-hub/demo-host',url:'http://localhost:4174',reuseExistingServer:false},
  ]
})
