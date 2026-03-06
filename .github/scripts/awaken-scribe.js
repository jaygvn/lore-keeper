const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

async function awakenScribe() {
  console.log("🪷 The Scribe is awakening...");
  
  try {
    // Read the agent's identity
    const agentPath = path.join(process.env.GITHUB_WORKSPACE, 'scribe.agent.md');
    const agentIdentity = fs.readFileSync(agentPath, 'utf8');
    
    // Read all lore files from a lore directory
    const loreDir = path.join(process.env.GITHUB_WORKSPACE, 'lore');
    let allLore = '';
    
    if (fs.existsSync(loreDir)) {
      const loreFiles = fs.readdirSync(loreDir)
        .filter(file => file.endsWith('.md'));
      
      for (const file of loreFiles) {
        const lorePath = path.join(loreDir, file);
        const loreContent = fs.readFileSync(lorePath, 'utf8');
        allLore += `\n\n## From ${file}:\n${loreContent}`;
      }
      console.log(`📚 Loaded ${loreFiles.length} lore scrolls`);
    } else {
      console.log('📭 No lore directory found, using only agent identity');
    }
    
    // Get message
    let userMessage = process.env.MANUAL_MESSAGE || "The pond is still...";
    
    // Build the complete prompt with ALL lore
    const fullPrompt = `${agentIdentity}

${allLore ? `# The Sacred Scrolls You Guard:
${allLore}` : ''}

## Current Moment
A traveler approaches the pond and speaks: "${userMessage}"

## Your Response
As the ancient Cave Scribe, guardian of all these scrolls, respond to this traveler. Draw from the lore you protect. Be calm, wise, and mystical.`;

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    console.log('🤔 Consulting the ancient wisdom...');
    const result = await model.generateContent(fullPrompt);
    const response = await result.response.text();
    
    // Format response
    const scribeResponse = `🪷 *The pond ripples...*

${response}

---
*— Cave Scribe, Guardian of the Pond*
*"One scroll, one light. One leaf, one vow."*`;
    
    // Post to GitHub
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    
    const { data: issue } = await octokit.issues.create({
      owner,
      repo,
      title: `🪷 The Cave Scribe Speaks - ${new Date().toLocaleString()}`,
      body: scribeResponse
    });
    
    console.log(`✅ The Scribe has spoken in issue #${issue.number}`);
    
  } catch (error) {
    console.error('❌ The pond is troubled:', error.message);
  }
}

awakenScribe();
